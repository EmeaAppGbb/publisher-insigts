import assert from 'node:assert/strict'
import { readFileSync, readdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'
import { approvalFields } from '../src/labels.ts'
import type { ToolCall } from '../src/live/protocol.ts'
import { parseReply } from '../src/live/reply.ts'
import { CANCELLED, type TurnLog } from '../src/live/turn.ts'
import { MOCK_ANSWERS, MOCK_CONSENT_URL, MOCK_REPRINT, MOCK_SESSION, asksForReprint, createMockClient } from '../src/mock/client.ts'
import { SAMPLES } from '../src/samples.ts'

const app = fileURLToPath(new URL('../', import.meta.url))
// The samples with a canned answer; a sample that asks to submit a reprint request plays the approval flow.
const ANSWERED = SAMPLES.filter((sample) => !asksForReprint(sample.question))

test('mock mode answers every sample question for both agents with its canned reply, through the same turn', async () => {
  const records: TurnLog[] = []
  const client = createMockClient({ delayMs: 0, log: (record) => { records.push(record) } })
  assert.equal(client.mode, 'mock')
  assert.deepEqual(Object.keys(MOCK_ANSWERS), ANSWERED.map((sample) => sample.question))
  for (const sample of ANSWERED) {
    for (const variant of ['with_iq', 'without_iq'] as const) {
      const canned = MOCK_ANSWERS[sample.question][variant]
      const tools: ToolCall[] = []
      let result = await client.ask({ variant, text: sample.question }, undefined, (call) => tools.push(call))
      if (canned.consent) {
        assert.deepEqual([result.status, result.status === 'needs-consent' && result.server], ['needs-consent', canned.consent], sample.question)
        assert.equal(result.status === 'needs-consent' && result.consentUrl, MOCK_CONSENT_URL)
        result = await client.ask({ variant, text: sample.question }, undefined, (call) => tools.push(call))
      }
      assert.equal(result.status, 'answered', `${sample.question} ${variant}`)
      if (result.status !== 'answered') continue
      assert.equal(result.raw, canned.answer)
      assert.deepEqual(result.reply, parseReply(canned.answer))
      assert.match(result.responseId ?? '', /^resp_mock_[0-9a-f]{32}$/)
      assert.deepEqual(result.toolCalls.map((call) => [call.server, call.tool, call.state]), canned.tools.map((tool) => [tool.server, tool.tool, 'completed']))
      assert.deepEqual(tools.map((call) => call.state), canned.tools.flatMap(() => ['running', 'completed']), 'the timeline sees each call start and finish')
      if (variant === 'with_iq') assert.ok(result.reply.markers.length > 0 && result.reply.sources.length > 0, sample.question)
      else assert.deepEqual([result.reply.markers, result.reply.sources, result.toolCalls], [[], [], []], sample.question)
    }
  }
  assert.ok(records.every((record) => record.event === 'app.turn'))
})

test('a reprint request plays the approval flow: the held request with the week’s option, then the approved or rejected answer', async () => {
  const question = SAMPLES.find((sample) => asksForReprint(sample.question))?.question ?? 'Submit the recommended reprint request for The Glass Orchard'
  assert.equal(asksForReprint('Raise a reprint request for The Glass Orchard'), true)
  for (const other of ['Who may approve a reprint request for The Glass Orchard?', 'Submit a reprint request for Northbound Signals']) {
    assert.equal(asksForReprint(other), false, other)
  }
  const client = createMockClient({ delayMs: 0 })
  const tools: ToolCall[] = []
  const held = await client.ask({ variant: 'with_iq', text: question }, undefined, (call) => tools.push(call))
  assert.equal(held.status, 'needs-approval')
  if (held.status !== 'needs-approval') return
  assert.match(held.approval.id, /^mcpr_mock_[0-9a-f]{32}$/)
  assert.deepEqual([held.approval.server, held.approval.tool], ['reprint_request', 'submit_reprint_request'])
  assert.deepEqual(held.toolCalls.map((call) => [call.server, call.tool, call.state]), [['fabric_iq_ontology', 'ask_ontology', 'completed'], ['foundry_iq_knowledge', 'knowledge_base_retrieve', 'completed']])
  assert.deepEqual(tools.map((call) => call.state), ['running', 'completed', 'running', 'completed'])
  assert.deepEqual(approvalFields(held.approval).map((field) => [field.label, field.value]), [
    ['Edition', 'ed-001-hb'], ['Territory', 'UK'], ['Quantity', '20,000'], ['Expedited', 'Yes'], ['Investment', '£50,000'],
    ['Signal', 'sig-20261102-title-001-inv-ed-001-hb-uk'], ['Option', 'sig-20261102-title-001-inv-ed-001-hb-uk-expedite'],
    ['Rationale', MOCK_REPRINT.approval.arguments.rationale], ['Evidence', MOCK_REPRINT.approval.arguments.evidence],
  ])
  assert.match(String(MOCK_REPRINT.approval.arguments.evidence), /sig-20261102-title-001-inv-ed-001-hb-uk.*BKS-POL-001 §6.*BKS-GOV-003 §1/)
  const decide = (approve: boolean) => client.ask({ variant: 'with_iq', approval: { id: held.approval.id, approve }, previousResponseId: held.responseId })

  const approved = await decide(true)
  assert.equal(approved.status, 'answered')
  if (approved.status !== 'answered') return
  assert.deepEqual(approved.reply, parseReply(MOCK_REPRINT.approved.answer))
  assert.deepEqual(approved.reply.markers.map((marker) => marker.id), ['A1', 'D1', 'F1'])
  assert.deepEqual(approved.reply.sources[0], {
    id: 'A1', kind: 'action', text: 'Reprint request · rr-20261102-title-001-inv-ed-001-hb-uk · Approved · Mock user (Publishing director) · 2026-11-18T10:15:00Z',
  })
  assert.deepEqual(approved.reply.usedIqs, ['fabric', 'foundry', 'action'])
  assert.equal(approved.reply.steps.length, 3)
  assert.deepEqual(approved.toolCalls.map((call) => [call.server, call.tool, call.state]), [['reprint_request', 'submit_reprint_request', 'completed']])

  const rejected = await decide(false)
  assert.deepEqual([rejected.status, rejected.toolCalls], ['answered', []])
  assert.match(rejected.status === 'answered' ? rejected.reply.answer : '', /^\*\*Nothing was submitted: you rejected/)
  const withoutIq = await client.ask({ variant: 'without_iq', text: question })
  assert.deepEqual([withoutIq.status, withoutIq.toolCalls], ['answered', []])
  assert.match(withoutIq.status === 'answered' ? withoutIq.reply.answer : '', /^\*\*Nothing was submitted: this version/)
})

test('other questions get a canned pointer to the samples, and a mock turn can be stopped', async () => {
  const client = createMockClient({ delayMs: 0 })
  const other = await client.ask({ variant: 'with_iq', text: 'How many sites are there?' })
  assert.match(other.status === 'answered' ? other.raw : '', /canned answers for the sample questions only/)
  const controller = new AbortController()
  const pending = createMockClient({ delayMs: 5_000 }).ask({ variant: 'with_iq', text: SAMPLES[0].question }, controller.signal)
  setTimeout(() => controller.abort(), 10)
  const stopped = await pending
  assert.equal(stopped.status === 'failed' && stopped.code, CANCELLED)
  assert.ok(stopped.elapsedMs < 5_000)
})

test('mock mode needs no sign-in and labels itself', () => {
  assert.equal(MOCK_SESSION.mode, 'mock')
  assert.equal(MOCK_SESSION.identity?.name, 'Mock user')
  assert.match(MOCK_SESSION.notice ?? '', /^Mock mode/)
})

test('only literal mode checks load the mock module, and nothing loads the sign-in statically', () => {
  const source = readFileSync(new URL('../src/live/client.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /^import\b[^\n]*\.\/auth/m, 'no static import of the browser sign-in')
  assert.doesNotMatch(source, /^import\b[^\n]*mock\//m, 'no static import of the mock module')
  const loads = source.match(/import\('\.\.\/mock\/client\.ts'\)/g) ?? []
  const guards = source.match(/if \(import\.meta\.env\.MODE === 'mock'\) \{/g) ?? []
  assert.equal(loads.length, 2)
  assert.equal(guards.length, loads.length)
  for (const block of source.split(/^(?:export )?(?:async )?function /m).filter((part) => part.includes("import('../mock/client.ts')"))) {
    assert.ok(block.indexOf("if (import.meta.env.MODE === 'mock') {") < block.indexOf("import('../mock/client.ts')"), block.slice(0, 60))
  }
  for (const file of readdirSync(new URL('../src/', import.meta.url), { recursive: true, encoding: 'utf8' })) {
    if (!/\.tsx?$/.test(file) || file.startsWith(`mock${path.sep}`) || file === path.join('live', 'client.ts')) continue
    const text = readFileSync(new URL(`../src/${file.split(path.sep).join('/')}`, import.meta.url), 'utf8')
    assert.doesNotMatch(text, /mock\/client/, `${file} must not import the mock module`)
  }
})

test('a production build contains no mock text', async () => {
  const outDir = path.join(app, 'node_modules', '.tmp', `production-check-${process.pid}`)
  try {
    await build({ configFile: path.join(app, 'vite.config.ts'), mode: 'production', logLevel: 'silent', build: { outDir, emptyOutDir: true } })
    const files = readdirSync(outDir, { recursive: true, encoding: 'utf8' }).filter((file) => /\.(?:html|js|css)$/.test(file))
    const bundle = files.map((file) => readFileSync(path.join(outDir, file), 'utf8')).join('\n')
    assert.ok(files.includes('index.html') && files.includes('redirect.html'), 'the app and its redirect bridge')
    assert.ok(bundle.includes('Sample questions'), 'the probe reads the app itself')
    const mockSource = readFileSync(new URL('../src/mock/client.ts', import.meta.url), 'utf8')
    const probes = [
      MOCK_SESSION.notice ?? '', MOCK_CONSENT_URL, 'resp_mock_', 'mcpr_mock_', 'canned answers for the sample questions only',
      // Each canned answer's bold lead.
      ...[...Object.values(MOCK_ANSWERS).map((answers) => answers.with_iq), MOCK_REPRINT.approved, MOCK_REPRINT.rejected, MOCK_REPRINT.withoutIq]
        .map((canned) => /\*\*(.+?)\*\*/.exec(canned.answer)?.[1] ?? ''),
    ]
    for (const probe of probes) {
      assert.ok(probe && mockSource.includes(probe), `${probe} is mock text`)
      assert.ok(!bundle.includes(probe), `the production bundle must not contain ${probe}`)
    }
  } finally {
    rmSync(outDir, { recursive: true, force: true })
  }
})
