import assert from 'node:assert/strict'
import test from 'node:test'
import { newTurn, reduce, type Exchange, type Thread, type Turn } from '../src/exchanges.ts'
import { parseReply } from '../src/live/reply.ts'
import type { ApprovalRequest, ToolCall, TurnResult } from '../src/live/types.ts'
import { ladderState, pipelineState, runMetrics, sessionIqStats, type PipelineState } from '../src/story.ts'

const call = (id: string, server: string, state: ToolCall['state'] = 'completed'): ToolCall => ({ id, server, tool: 'tool', state, ...(state === 'running' ? {} : { ms: 500 }) })
const approval: ApprovalRequest = { id: 'mcpr_1', server: 'reprint_request', tool: 'submit_reprint_request', arguments: { territory: 'UK' } }
const held: TurnResult = { status: 'needs-approval', approval, elapsedMs: 1200, responseId: 'resp_1', toolCalls: [call('c1', 'fabric_iq_ontology'), call('c2', 'foundry_iq_knowledge')] }
const answered = (text: string, toolCalls: ToolCall[] = [], elapsedMs = 800): TurnResult => ({ status: 'answered', reply: parseReply(text), raw: text, elapsedMs, responseId: 'resp_2', toolCalls })
const RECORDED = 'Recorded [A1].\n\nSources\n- [A1] Reprint request · rr-20261102-x · Approved · A user · 2026-11-18T10:15:00Z\n- [D1] BooksOntology · DecisionOption · x'

const turn = (id: string, extra: Partial<Turn> = {}): Turn => ({ ...newTurn(id, extra.approval ? '' : 'q', 0), ...extra })
const done = (id: string, result: TurnResult, extra: Partial<Turn> = {}): Turn => turn(id, { running: false, result, toolCalls: result.toolCalls, ...extra })
const decision = (id: string, approve: boolean, result?: TurnResult): Turn =>
  result ? done(id, result, { approval: { id: 'mcpr_1', approve }, previousResponseId: 'resp_1' }) : turn(id, { approval: { id: 'mcpr_1', approve }, previousResponseId: 'resp_1' })
const act = (...turns: Turn[]): Exchange => ({ id: 'e-act', question: 'q', stage: 'act', threads: [{ id: 'with', variant: 'with_iq', turns }] })

test('the reprint request’s pipeline follows the with-IQ thread from the first ask to the recorded request', () => {
  const cases: [PipelineState, Exchange | undefined][] = [
    ['none', undefined],
    ['preparing', act(turn('t1'))],
    ['consent', act(done('t1', { status: 'needs-consent', consentUrl: 'https://login.example/x', server: 'reprint_request', elapsedMs: 1, toolCalls: [] }))],
    ['awaiting', act(done('t1', held))],
    ['submitting', act(done('t1', held), decision('t2', true))],
    ['recorded', act(done('t1', held), decision('t2', true, answered(RECORDED)))],
    ['rejected', act(done('t1', held), decision('t2', false, answered('Nothing went [D1].\n\nSources\n- [D1] x')))],
    ['rejected', act(done('t1', held), decision('t2', false))],
    ['not-submitted', act(done('t1', { status: 'failed', message: 'Foundry answered HTTP 503.', elapsedMs: 1, toolCalls: [] }))],
    ['not-submitted', act(done('t1', answered('No proposal [D1].\n\nSources\n- [D1] x')))],
    // Approved, but the app saw no recorded request: it can't tell whether the server wrote one.
    ['unconfirmed', act(done('t1', held), decision('t2', true, answered('Submitted, I think.')))],
    ['unconfirmed', act(done('t1', held), decision('t2', true, { status: 'failed', message: 'The agent took too long.', code: 'timeout', elapsedMs: 1, toolCalls: [] }))],
    ['recorded', act(done('t1', held), decision('t2', true, answered(RECORDED)), turn('t3', { previousResponseId: 'resp_2' }))],
    ['awaiting', act(done('t1', held), decision('t2', true, answered(RECORDED)), done('t3', { ...held, approval: { ...approval, id: 'mcpr_2' } }))],
  ]
  for (const [expected, exchange] of cases) {
    const last = exchange?.threads[0].turns.at(-1)
    assert.equal(pipelineState(exchange), expected, `${last?.id} ${last?.running ? 'running' : last?.result?.status}`)
  }
  const withoutIq: Exchange = { id: 'e', question: 'q', threads: [{ id: 'w', variant: 'without_iq', turns: [done('t1', answered('No tools.'))] }] }
  assert.equal(pipelineState(withoutIq), 'none', 'only the agent with IQ can propose the request')
})

test('the value ladder reads the newest Act exchange and never infers the risk actioned', () => {
  const ladder = (exchanges: Exchange[]) => ladderState(exchanges).map((stage) => [stage.id, stage.value, stage.status])
  assert.deepEqual(ladder([]), [['proposed', '—', 'active'], ['approved', '—', 'todo'], ['recorded', '—', 'todo'], ['actioned', 'Ask below', 'todo']])
  assert.deepEqual(ladder([act(done('t1', held))]).map(([, value, status]) => [value, status]), [['Yes', 'done'], ['—', 'active'], ['—', 'todo'], ['Ask below', 'todo']])
  assert.deepEqual(ladder([act(done('t1', held), decision('t2', true))]).map(([, value, status]) => [value, status]), [['Yes', 'done'], ['Yes', 'done'], ['—', 'active'], ['Ask below', 'todo']])
  assert.deepEqual(ladder([act(done('t1', held), decision('t2', true, answered(RECORDED)))]), [
    ['proposed', 'Yes', 'done'], ['approved', 'Yes', 'done'], ['recorded', 'rr-20261102-x', 'done'], ['actioned', 'Ask below', 'active'],
  ])
  const noId = 'Recorded [A1].\n\nSources\n- [A1] Reprint request · Approved'
  assert.equal(ladderState([act(done('t1', held), decision('t2', true, answered(noId)))])[2].value, 'Yes', 'recorded without a request ID')
  assert.deepEqual(ladder([act(done('t1', held), decision('t2', false, answered('No.')))]).map(([, value, status]) => [value, status]), [['Yes', 'done'], ['Rejected', 'active'], ['—', 'todo'], ['Ask below', 'todo']])
  const older = act(done('t1', held), decision('t2', true, answered(RECORDED)))
  const newer: Exchange = { ...act(turn('t9')), id: 'e-new' }
  assert.equal(ladderState(reduce(reduce([], { type: 'ask', exchange: older }), { type: 'ask', exchange: newer }))[0].status, 'active', 'asking again starts a new ladder')
})

test('a run’s metrics come from the thread’s latest answer: source lines, IQ calls, IQs used and time', () => {
  const thread = (...turns: Turn[]): Thread => ({ id: 'with', variant: 'with_iq', turns })
  assert.equal(runMetrics(undefined), undefined)
  assert.equal(runMetrics(thread(turn('t1', { toolCalls: [call('c1', 'fabric_iq_ontology', 'running')] }))), undefined, 'nothing until it answers')
  assert.equal(runMetrics(thread(done('t1', held))), undefined, 'a held request is no answer')
  const calls = [call('c1', 'fabric_iq_ontology'), call('c2', 'fabric_iq_ontology'), call('c3', 'web_iq_public_context'), call('c4', 'reprint_request'), call('c5', 'other_server')]
  const text = 'Answer [D1] [Web1].\n\nSources\n- [D1] row one\n- [D1] row two\n- [Web1] page · https://example.com/a'
  const first = done('t1', answered(text, calls, 2400))
  assert.deepEqual(runMetrics(thread(first)), { sources: 3, calls: 3, iqs: 2, elapsedMs: 2400 })
  assert.deepEqual(runMetrics(thread(first, turn('t2', { previousResponseId: 'resp_2' }))), { sources: 3, calls: 3, iqs: 2, elapsedMs: 2400 }, 'a running follow-up keeps the last answer’s')
})

test('the session’s calls per IQ count every thread’s tool calls, running ones too, and its answers’ sources by kind', () => {
  const exchanges: Exchange[] = [
    act(done('t1', held), decision('t2', true, answered(RECORDED, [call('c3', 'reprint_request')]))),
    {
      id: 'e2', question: 'q', threads: [
        { id: 'a', variant: 'with_iq', turns: [done('t3', answered('A [Web1] [W1].\n\nSources\n- [Web1] page\n- [W1] mail', [call('c4', 'web_iq_public_context'), call('c5', 'work_iq_mail')]))] },
        { id: 'b', variant: 'without_iq', turns: [done('t4', answered('No tools.'))] },
      ],
    },
    { id: 'e3', question: 'q', threads: [{ id: 'c', variant: 'with_iq', turns: [turn('t5', { toolCalls: [call('c6', 'fabric_iq_ontology', 'running'), call('c7', 'unknown')] })] }] },
  ]
  assert.deepEqual(sessionIqStats(exchanges), {
    fabric: { calls: 2, sources: 1 },
    foundry: { calls: 1, sources: 0 },
    web: { calls: 1, sources: 1 },
    work: { calls: 1, sources: 1 },
    action: { calls: 1, sources: 1 },
  })
  assert.deepEqual(sessionIqStats([]).fabric, { calls: 0, sources: 0 })
})
