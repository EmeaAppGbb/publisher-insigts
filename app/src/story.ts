// The guided story around the live answers: its pages, the sample question each stage asks, the five steps and their
// narrative, and the pure derivations the pages show: the reprint request's pipeline, the value ladder, one run's
// metrics and the session's calls per IQ. Every number here is one the app measures itself; business figures come
// only from the agents' cited answers.
import { latestExchange, pendingApproval, type Exchange, type Thread, type Turn } from './exchanges.ts'
import { iqOf } from './live/protocol.ts'
import type { IqKey } from './live/types.ts'
import type { SampleId } from './samples.ts'

export type PageId = 'signal' | 'understand' | 'decide' | 'act' | 'measure' | 'ask'
export type UnderstandStage = 'understand:sales' | 'understand:policy' | 'understand:shortlists' | 'understand:mail'
export type Stage = 'signal' | UnderstandStage | 'decide' | 'act' | 'measure'

export interface Page {
  id: PageId
  label: string
  icon: string
  // The topbar's crumb while the page shows.
  crumb: string
}

export const PAGES: readonly Page[] = [
  { id: 'signal', label: 'Signal', icon: '⌂', crumb: 'This week’s signals' },
  { id: 'understand', label: 'Understand', icon: '✳', crumb: 'Evidence · four IQs' },
  { id: 'decide', label: 'Decide', icon: '◇', crumb: 'Options · authority' },
  { id: 'act', label: 'Act', icon: '↗', crumb: 'Governed action · your approval' },
  { id: 'measure', label: 'Measure', icon: '◌', crumb: 'Outcome · accountability' },
  { id: 'ask', label: 'Ask', icon: '✎', crumb: 'Ask anything · with and without IQ' },
]

// The question each stage asks: a sample, so every story question has an eval case.
export const STAGE_SAMPLES: Readonly<Record<Stage, SampleId>> = {
  signal: 'attention',
  'understand:sales': 'sales',
  'understand:policy': 'policy',
  'understand:shortlists': 'shortlists',
  'understand:mail': 'mail',
  decide: 'options',
  act: 'reprint',
  measure: 'outcome',
}

// Where a story exchange was asked, as the Ask page's history names it.
export const STAGE_LABELS: Readonly<Record<Stage, string>> = {
  signal: 'Signal',
  'understand:sales': 'Understand · Sales',
  'understand:policy': 'Understand · Policy',
  'understand:shortlists': 'Understand · Market',
  'understand:mail': 'Understand · Team',
  decide: 'Decide',
  act: 'Act',
  measure: 'Measure',
}

// The Understand page's tabs: one kind of evidence each, from its own IQ.
export const UNDERSTAND_TABS: readonly { stage: UnderstandStage; label: string; iq: IqKey; knows: string }[] = [
  {
    stage: 'understand:sales', label: 'Sales · Fabric IQ', iq: 'fabric',
    knows: 'What the business knows: sales, forecasts, stock, signals and options, from the live ontology.',
  },
  {
    stage: 'understand:policy', label: 'Policy · Foundry IQ', iq: 'foundry',
    knows: 'What approved policy says: the reprint and stock policy, the decision authority matrix and the other governed documents.',
  },
  {
    stage: 'understand:shortlists', label: 'Market · Web IQ', iq: 'web',
    knows: 'What the outside world signals: public coverage, searched in public terms only, never a title, author or company.',
  },
  {
    stage: 'understand:mail', label: 'Team · Work IQ', iq: 'work',
    knows: 'What your team knows: your own mail, read as you, when the deployment enables Work IQ.',
  },
]

export interface Step {
  page: PageId
  // The question the step asks when its page has no answer yet.
  stage: Stage
  label: string
  // The toast's narrative as the step opens.
  text: string
}

export const STEPS: readonly Step[] = [
  {
    page: 'signal', stage: 'signal', label: 'Signal',
    text: 'A title is breaking out. The ontology marks what is material this week; the agent explains it, with a source for every fact.',
  },
  {
    page: 'understand', stage: 'understand:sales', label: 'Understand',
    text: 'Why is it moving? Sales from Fabric IQ, policy from Foundry IQ, public context from Web IQ and the team’s mail from Work IQ, each read as you.',
  },
  {
    page: 'decide', stage: 'decide', label: 'Decide',
    text: 'Not one opaque answer: each option from its row, and the approver the decision authority matrix names.',
  },
  {
    page: 'act', stage: 'act', label: 'Act',
    text: 'The agent prepares the one change it may make. Nothing is submitted until you approve, and the server checks your role first.',
  },
  {
    page: 'measure', stage: 'measure', label: 'Measure',
    text: 'Approval isn’t value. The request is recorded, then the next signal run marks the risk actioned.',
  },
]

export function isPageId(value: unknown): value is PageId {
  return PAGES.some((page) => page.id === value)
}

export function isUnderstandStage(value: unknown): value is UnderstandStage {
  return UNDERSTAND_TABS.some((tab) => tab.stage === value)
}

// The stage whose answer a page shows: the open tab's on Understand, none on Ask.
export function pageStage(page: PageId, tab: UnderstandStage): Stage | undefined {
  if (page === 'ask') return undefined
  return page === 'understand' ? tab : page
}

export function withIqThread(exchange: Exchange | undefined): Thread | undefined {
  return exchange?.threads.find((thread) => thread.variant === 'with_iq')
}

// Where the reprint request stands, from the with-IQ thread of the Act page's exchange. Unconfirmed: you approved,
// but the turn failed or its answer cites no recorded request, so the app can't tell whether the server wrote one.
export type PipelineState =
  | 'none' | 'preparing' | 'consent' | 'awaiting' | 'submitting' | 'recorded' | 'rejected' | 'unconfirmed' | 'not-submitted'

export const PIPELINE_TITLES: Readonly<Record<PipelineState, string>> = {
  none: 'Not started',
  preparing: 'The agent is preparing it…',
  consent: 'Consent needed',
  awaiting: 'Your decision is needed',
  submitting: 'Submitting as you…',
  recorded: 'Recorded',
  rejected: 'Rejected · nothing submitted',
  unconfirmed: 'Approved · no record returned',
  'not-submitted': 'Not submitted',
}

// An approved decision whose answer cites the reprint request the server recorded.
function recordedBy(turn: Turn): boolean {
  const result = turn.running ? undefined : turn.result
  return turn.approval?.approve === true && result?.status === 'answered' && result.reply.sources.some((source) => source.kind === 'action')
}

function lastTurnState(thread: Thread, last: Turn): PipelineState {
  // A rejection is final as soon as it is sent: nothing will be submitted.
  if (last.running) return last.approval ? (last.approval.approve ? 'submitting' : 'rejected') : 'preparing'
  const result = last.result
  if (result?.status === 'needs-approval' && pendingApproval(thread)) return 'awaiting'
  if (result?.status === 'needs-consent') return 'consent'
  if (last.approval) return !last.approval.approve ? 'rejected' : recordedBy(last) ? 'recorded' : 'unconfirmed'
  // No approval was given, so nothing can have been submitted.
  return 'not-submitted'
}

export function pipelineState(exchange: Exchange | undefined): PipelineState {
  const thread = withIqThread(exchange)
  const last = thread?.turns.at(-1)
  if (!thread || !last) return 'none'
  const state = lastTurnState(thread, last)
  // A request recorded earlier in the thread stays recorded through a later follow-up.
  const followUp = state === 'not-submitted' || state === 'unconfirmed' || (state === 'preparing' && last !== thread.turns[0])
  return followUp && thread.turns.some(recordedBy) ? 'recorded' : state
}

export type LadderId = 'proposed' | 'approved' | 'recorded' | 'actioned'

export interface LadderStage {
  id: LadderId
  label: string
  description: string
  value: string
  status: 'done' | 'active' | 'todo'
}

const LADDER: readonly Pick<LadderStage, 'id' | 'label' | 'description'>[] = [
  { id: 'proposed', label: 'Proposed', description: 'The agent held a request for your decision.' },
  { id: 'approved', label: 'Approved', description: 'You approved it, as yourself.' },
  { id: 'recorded', label: 'Recorded', description: 'The reprint server wrote it and read it back.' },
  { id: 'actioned', label: 'Actioned', description: 'The next signal run marks the risk actioned. The live answer below shows it.' },
]

// The request ID the reprint request's source line names, such as "Reprint request · rr-… · Approved · …".
function requestId(turn: Turn | undefined): string | undefined {
  const result = turn?.result
  if (result?.status !== 'answered') return undefined
  const fields = result.reply.sources.filter((source) => source.kind === 'action').flatMap((source) => source.text.split(' · '))
  return fields.map((field) => field.trim()).find((field) => field.startsWith('rr-'))
}

// The value ladder from the newest Act exchange: each stage is done once this session shows it; the first stage not
// done is active. Actioned is never inferred: only the Measure page's live answer shows it.
export function ladderState(exchanges: readonly Exchange[]): LadderStage[] {
  const exchange = latestExchange(exchanges, 'act')
  const turns = withIqThread(exchange)?.turns ?? []
  const proposed = turns.some((turn) => !turn.running && turn.result?.status === 'needs-approval')
  const decision = turns.findLast((turn) => turn.approval)?.approval?.approve
  const recorded = turns.findLast(recordedBy)
  const values: Record<LadderId, { value: string; done: boolean }> = {
    proposed: { value: proposed ? 'Yes' : '—', done: proposed },
    approved: { value: decision === undefined ? '—' : decision ? 'Yes' : 'Rejected', done: decision === true },
    recorded: { value: recorded ? requestId(recorded) ?? 'Yes' : '—', done: Boolean(recorded) },
    actioned: { value: 'Ask below', done: false },
  }
  const active = LADDER.findIndex((stage) => !values[stage.id].done)
  return LADDER.map((stage, index) => ({
    ...stage,
    value: values[stage.id].value,
    status: values[stage.id].done ? 'done' : index === active ? 'active' : 'todo',
  }))
}

const IQS: ReadonlySet<IqKey> = new Set(['fabric', 'foundry', 'web', 'work'])

export interface RunMetrics {
  // Source lines the answer listed.
  sources: number
  // Calls to the four IQs; the reprint request is an action, not an IQ.
  calls: number
  iqs: number
  elapsedMs: number
}

// What the thread's latest answer measured about its own run, or undefined until it has answered.
export function runMetrics(thread: Thread | undefined): RunMetrics | undefined {
  const result = thread?.turns.findLast((turn) => !turn.running && turn.result?.status === 'answered')?.result
  if (result?.status !== 'answered') return undefined
  const iqs = result.toolCalls.map((call) => iqOf(call.server)).filter((iq) => iq !== undefined && IQS.has(iq))
  return { sources: result.reply.sources.length, calls: iqs.length, iqs: new Set(iqs).size, elapsedMs: result.elapsedMs }
}

export type IqStats = Record<IqKey, { calls: number; sources: number }>

// This session's tool calls by IQ, running ones included, and its answers' source lines by kind, over every thread.
export function sessionIqStats(exchanges: readonly Exchange[]): IqStats {
  const stats: IqStats = {
    fabric: { calls: 0, sources: 0 },
    foundry: { calls: 0, sources: 0 },
    web: { calls: 0, sources: 0 },
    work: { calls: 0, sources: 0 },
    action: { calls: 0, sources: 0 },
  }
  for (const turn of exchanges.flatMap((exchange) => exchange.threads.flatMap((thread) => thread.turns))) {
    for (const call of turn.toolCalls) {
      const iq = iqOf(call.server)
      if (iq) stats[iq].calls += 1
    }
    const result = turn.running ? undefined : turn.result
    if (result?.status === 'answered') for (const source of result.reply.sources) stats[source.kind].sources += 1
  }
  return stats
}
