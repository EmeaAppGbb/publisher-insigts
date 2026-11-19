import assert from 'node:assert/strict'
import test from 'node:test'
import type { User } from '../src/auth.ts'
import { createDatabase } from '../src/kusto.ts'
import { createRequestService, type Outcome, type ReprintArguments } from '../src/requests.ts'
import {
  ACTIONED, DATABASE_GUID, EXPEDITE, FakeKusto, REALLOCATE, SIGNAL, STANDARD, director, expediteArguments, now, requestRow,
} from './support.ts'

const REQUEST_ID = 'rr-20261102-title-001-inv-ed-001-hb-uk'
const publishingDirector: User = { objectId: director, name: 'Rowan Ashdown', roles: ['Reprint.PublishingDirector'] }
const manager: User = { objectId: '44444444-4444-4444-8444-444444444444', name: 'Ilse Marrow', roles: ['Reprint.ProductionPlanningManager'] }
const head: User = { objectId: '55555555-5555-4555-8555-555555555555', name: 'Dev Okonkwo-Hale', roles: ['Reprint.HeadOfProductionPlanning'] }
const managingDirector: User = { objectId: '66666666-6666-4666-8666-666666666666', name: 'Saoirse Penhallow', roles: ['Reprint.ManagingDirector'] }

function setup(fake = new FakeKusto()) {
  return { fake, service: createRequestService({ database: createDatabase(fake, 'BookSignals'), clock: () => now }) }
}

const standardArguments = (): ReprintArguments => ({ ...expediteArguments(), option_id: STANDARD, quantity: 32000, expedited: false, investment_gbp: 67200 })
const appends = (fake: FakeKusto) => fake.calls.filter((call) => call.csl.startsWith('.append'))

// A refusal, which never repeats the rationale or the evidence.
function refused(outcome: Outcome, code: string, args: ReprintArguments = expediteArguments()): string {
  assert.equal(outcome.ok, false, JSON.stringify(outcome))
  assert.ok(!outcome.ok)
  assert.equal(outcome.code, code, outcome.message)
  assert.ok(!outcome.message.includes(args.rationale) && !outcome.message.includes(args.evidence), outcome.message)
  assert.ok(!/\bat \w+ \(|Error:/.test(outcome.message), 'no stack trace')
  return outcome.message
}

test("the publishing director's expedited reprint is recorded once, exactly as governed, and read back", async () => {
  const { fake, service } = setup()
  const outcome = await service.submit(expediteArguments(), publishingDirector)
  assert.deepEqual(outcome, {
    ok: true,
    request: {
      request_id: REQUEST_ID, status: 'Approved', title_name: 'The Glass Orchard', edition_id: 'ed-001-hb', territory: 'UK',
      quantity: 20000, expedited: true, investment_gbp: 50000, required_approver: 'Publishing director',
      approver_name: 'Rowan Ashdown', approver_role: 'Publishing director', approved_at: '2026-11-18T14:30:00.000Z', created: true,
    },
  })
  assert.deepEqual(fake.requests, [{
    request_id: REQUEST_ID, signal_id: SIGNAL, option_id: EXPEDITE, title_id: 'title-001', title_name: 'The Glass Orchard',
    edition_id: 'ed-001-hb', territory: 'UK', quantity: 20000, expedited: 'Yes', investment_gbp: 50000,
    rationale: expediteArguments().rationale, evidence: expediteArguments().evidence, required_approver: 'Publishing director',
    approver_role: 'Publishing director', approver_name: 'Rowan Ashdown', approver_object_id: director,
    approved_at: '2026-11-18T14:30:00Z', status: 'Approved', as_of_week: '2026-11-02T00:00:00Z',
  }])
  assert.deepEqual(appends(fake).map((call) => [call.endpoint, call.db]), [['mgmt', DATABASE_GUID]])
  assert.ok(fake.tags.has(REQUEST_ID), 'tagged with its request ID')
  assert.ok(fake.calls.every((call) => !call.csl.includes('Rowan') && !call.csl.includes('cover runs out')), 'no free text in KQL')
})

test('BKS-GOV-003: the required approver or a more senior one approves; anyone else is told who may', async () => {
  const message = refused(await setup().service.submit(standardArguments(), manager), 'role_insufficient', standardArguments())
  assert.equal(message, "A standard reprint of £67,200 needs the head of production planning's approval (BKS-GOV-003 §1), and your "
    + 'sign-in does not hold that role. A more senior approver in the production line may approve it instead (§2): the publishing '
    + 'director or the managing director.')
  const roleless = refused(await setup().service.submit(expediteArguments(), { ...head, roles: [] }), 'role_insufficient')
  assert.match(roleless, /^An expedited reprint of £50,000 needs the publishing director's approval \(BKS-GOV-003 §1\).*the managing director\.$/)
  refused(await setup().service.submit(expediteArguments(), head), 'role_insufficient')

  for (const [user, args, role, required] of [
    [head, standardArguments(), 'Head of production planning', 'Head of production planning'],
    [publishingDirector, standardArguments(), 'Publishing director', 'Head of production planning'],
    [managingDirector, expediteArguments(), 'Managing director', 'Publishing director'],
    [{ ...managingDirector, roles: ['Reprint.ManagingDirector', 'Reprint.PublishingDirector'] }, expediteArguments(), 'Publishing director', 'Publishing director'],
  ] as [User, ReprintArguments, string, string][]) {
    const { fake, service } = setup()
    const outcome = await service.submit(args, user)
    assert.ok(outcome.ok, JSON.stringify(outcome))
    assert.deepEqual([outcome.request.approver_role, outcome.request.required_approver, outcome.request.approver_name], [role, required, user.name])
    assert.equal(fake.requests[0].approver_object_id, user.objectId)
  }
  const { fake, service } = setup()
  refused(await service.submit(expediteArguments(), { objectId: director, roles: ['Reprint.PublishingDirector'] }), 'no_name')
  assert.equal(appends(fake).length, 0)
})

test('every value must copy the governed option: the differing field is named with the value to use', async () => {
  const { fake, service } = setup()
  for (const [change, expected] of [
    [{ edition_id: 'ed-001-pb' }, `edition_id differs from the governed option ${EXPEDITE}: use ed-001-hb.`],
    [{ territory: 'US' }, `territory differs from the governed option ${EXPEDITE}: use UK.`],
    [{ quantity: 32000 }, `quantity differs from the governed option ${EXPEDITE}: use 20000 (the option's units).`],
    [{ expedited: false }, `expedited differs from the governed option ${EXPEDITE}: use true.`],
    [{ investment_gbp: 49999 }, `investment_gbp differs from the governed option ${EXPEDITE}: use 50000.`],
    [{ option_id: STANDARD }, `quantity differs from the governed option ${STANDARD}: use 32000 (the option's units).`],
  ] as [Partial<ReprintArguments>, string][]) {
    const args = { ...expediteArguments(), ...change }
    assert.equal(refused(await service.submit(args, publishingDirector), 'argument_mismatch', args), expected)
  }
  assert.equal(appends(fake).length, 0)
})

test("only the current week's open inventory risk and its expedite or standard reprint option can be requested", async () => {
  const { fake, service } = setup()
  const ask = /Ask Fabric IQ for the current week's inventory risk and its reprint options again/
  const stale = { ...expediteArguments(), signal_id: 'sig-20261026-title-001-inv-ed-001-hb-uk', option_id: 'sig-20261026-title-001-inv-ed-001-hb-uk-expedite' }
  assert.match(refused(await service.submit(stale, publishingDirector), 'signal_not_current', stale), ask)
  const variance = { ...expediteArguments(), signal_id: 'sig-20261102-title-001-fcv' }
  assert.match(refused(await service.submit(variance, publishingDirector), 'not_inventory_risk', variance), ask)
  const actioned = { ...expediteArguments(), signal_id: ACTIONED, option_id: `${ACTIONED}-standard` }
  assert.match(refused(await service.submit(actioned, publishingDirector), 'signal_not_open', actioned), /its status is Actioned\. Ask Fabric IQ/)
  const reallocate = { ...expediteArguments(), option_id: REALLOCATE, quantity: 8658, expedited: false, investment_gbp: 2597 }
  assert.equal(refused(await service.submit(reallocate, publishingDirector), 'not_reprint', reallocate),
    `Option ${REALLOCATE} is not a reprint. Submit the expedite or standard reprint option of signal ${SIGNAL}.`)
  const borrowed = { ...expediteArguments(), option_id: `${ACTIONED}-standard` }
  refused(await service.submit(borrowed, publishingDirector), 'option_other_signal', borrowed)
  const unknown = { ...expediteArguments(), option_id: `${SIGNAL}-airfreight` }
  assert.match(refused(await service.submit(unknown, publishingDirector), 'option_not_current', unknown), ask)
  assert.equal(appends(fake).length, 0)
})

test('the same request again returns the recorded one without a second write', async () => {
  const { fake, service } = setup()
  const first = await service.submit(expediteArguments(), publishingDirector)
  const again = await service.submit({ ...expediteArguments(), rationale: 'Asked again after the approval card timed out in the app.' }, publishingDirector)
  const colleague = await service.submit(expediteArguments(), managingDirector)
  assert.ok(first.ok && again.ok && colleague.ok)
  assert.deepEqual(again.request, { ...first.request, created: false })
  assert.deepEqual(colleague.request, { ...first.request, created: false }, 'the record keeps its first approver')
  assert.equal(fake.requests.length, 1)
  assert.equal(appends(fake).length, 1)
})

test('two calls at once record one request: the in-process lock serialises the check and the write', async () => {
  const { fake, service } = setup()
  fake.ingestIfNotExists = false
  const outcomes = await Promise.all([service.submit(expediteArguments(), publishingDirector), service.submit(expediteArguments(), managingDirector)])
  assert.deepEqual(outcomes.map((outcome) => outcome.ok && outcome.request.created), [true, false])
  assert.equal(fake.requests.length, 1)
  refused(await service.submit(standardArguments(), head), 'already_requested', standardArguments())
})

test('an edition and territory already actioned since the risk began is refused, naming that request', async () => {
  const earlier = requestRow({
    request_id: 'rr-20261026-title-001-inv-ed-001-hb-uk', signal_id: 'sig-20261026-title-001-inv-ed-001-hb-uk',
    option_id: 'sig-20261026-title-001-inv-ed-001-hb-uk-standard', expedited: 'No', approved_at: '2026-10-29T10:05:12.3400000Z',
  })
  const { fake, service } = setup()
  fake.record(earlier)
  assert.equal(refused(await service.submit(expediteArguments(), publishingDirector), 'already_requested'),
    'Reprint request rr-20261026-title-001-inv-ed-001-hb-uk (standard reprint, approved 2026-10-29) already actions this '
    + 'inventory risk for ed-001-hb in UK under BKS-POL-001 §6, so no second request is needed.')
  // This signal's other option counts too.
  const other = setup()
  other.fake.record(requestRow({ option_id: STANDARD, expedited: 'No', quantity: 32000, investment_gbp: 67200 }))
  assert.match(refused(await other.service.submit(expediteArguments(), publishingDirector), 'already_requested'), new RegExp(`^Reprint request ${REQUEST_ID} \\(standard reprint`))

  // A request before the risk began, or for another territory, leaves this one open.
  const open = setup()
  open.fake.record(requestRow({ request_id: 'rr-20260914-title-001-inv-ed-001-hb-uk', approved_at: '2026-09-15T08:00:00Z' }))
  open.fake.record(requestRow({ request_id: 'rr-20261102-title-001-inv-ed-001-hb-us', territory: 'US' }))
  const outcome = await open.service.submit(expediteArguments(), publishingDirector)
  assert.ok(outcome.ok && outcome.request.created)
  assert.equal(appends(fake).length + appends(other.fake).length, 0)
})

test('a failed append counts as written only when the row read back is this request', async () => {
  // Another replica records the same request first: the second append fails on its ingestIfNotExists tag.
  const raced = setup()
  raced.fake.beforeAppend = () => raced.fake.record(requestRow({ approver_name: 'Saoirse Penhallow', approver_role: 'Managing director' }))
  const replica = await raced.service.submit(expediteArguments(), publishingDirector)
  assert.ok(replica.ok)
  assert.deepEqual([replica.request.created, replica.request.approver_name, replica.request.approved_at],
    [false, 'Saoirse Penhallow', '2026-11-17T09:12:44.517Z'])
  assert.equal(raced.fake.requests.length, 1)

  // Another replica records the other option first.
  const crossed = setup()
  crossed.fake.beforeAppend = () => crossed.fake.record(requestRow({ option_id: STANDARD, expedited: 'No', quantity: 32000, investment_gbp: 67200 }))
  refused(await crossed.service.submit(expediteArguments(), publishingDirector), 'already_requested')

  // The append landed but its response was lost.
  const lost = setup()
  lost.fake.failAppend = 'after'
  const landed = await lost.service.submit(expediteArguments(), publishingDirector)
  assert.ok(landed.ok && landed.request.created && landed.request.approver_name === 'Rowan Ashdown')

  // Nothing landed: the request is not reported as recorded.
  const failed = setup()
  failed.fake.failAppend = 'before'
  assert.equal(refused(await failed.service.submit(expediteArguments(), publishingDirector), 'not_recorded'),
    'The reprint request could not be recorded, so production planning has not received it. Try again in a few minutes.')
  assert.equal(failed.fake.requests.length, 0)
})

test("the store's failures are refusals: an unresolved database or a failing query records nothing", async () => {
  const missing = new FakeKusto()
  missing.databases = [{ DatabaseName: 'BookEvents', PrettyName: '' }]
  const store = 'The reprint request store is unavailable, so nothing was recorded. Try again in a few minutes.'
  assert.equal(refused(await setup(missing).service.submit(expediteArguments(), publishingDirector), 'store_unavailable'), store)
  const ambiguous = new FakeKusto()
  ambiguous.databases.push({ DatabaseName: 'BookSignals', PrettyName: 'Archive' })
  assert.equal(refused(await setup(ambiguous).service.submit(expediteArguments(), publishingDirector), 'store_unavailable'), store)
  const broken = new FakeKusto()
  broken.query = async () => { throw new Error('socket hang up at Kusto.Data.Net.Client') }
  assert.equal(refused(await setup(broken).service.submit(expediteArguments(), publishingDirector), 'store_unavailable'), store)
})
