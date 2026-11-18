// The UI's words for variants, choices, tool states, durations and approval requests, and what each turn announces to
// screen readers.
import type { Turn } from './exchanges.ts'
import { IQ_NAMES, iqOf, type ApprovalRequest, type ApprovalValue } from './live/protocol.ts'
import { CANCELLED } from './live/turn.ts'
import type { IqKey, ToolCall, Variant } from './live/types.ts'

export type Choice = Variant | 'both'

export const CHOICES: readonly { value: Choice; label: string }[] = [
  { value: 'with_iq', label: 'With IQ' },
  { value: 'without_iq', label: 'Without IQ' },
  { value: 'both', label: 'Ask both' },
]

export const CHOICE_HINTS: Readonly<Record<Choice, string>> = {
  with_iq: 'The agent with its IQ tools: the live ontology, approved documents, public context and, when enabled, your mail.',
  without_iq: 'The same agent and instructions without any tool: it says what it can’t confirm.',
  both: 'Both agents side by side, each in its own run.',
}

export const VARIANT_LABELS: Readonly<Record<Variant, string>> = { with_iq: 'With IQ', without_iq: 'Without IQ' }

export const VARIANT_DETAILS: Readonly<Record<Variant, string>> = {
  with_iq: 'The agent with its IQ tools',
  without_iq: 'The same agent, no tools',
}

// What each marker letter cites, in the order the agents' instructions list them.
export const LEGEND: readonly { marker: string; iq: IqKey; what: string }[] = [
  { marker: 'D', iq: 'fabric', what: 'live ontology data' },
  { marker: 'F', iq: 'foundry', what: 'approved documents' },
  { marker: 'Web', iq: 'web', what: 'public context' },
  { marker: 'W', iq: 'work', what: 'your mail' },
  { marker: 'A', iq: 'action', what: 'submitted on approval' },
]

export const STATE_LABELS: Readonly<Record<ToolCall['state'], string>> = { running: 'Running', completed: 'Done', failed: 'Failed' }

export function iqName(server: string | undefined): string | undefined {
  const iq = server ? iqOf(server) : undefined
  return iq ? IQ_NAMES[iq] : undefined
}

export function duration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`
  return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`
}

export interface ApprovalCopy {
  title: string
  // What approving does, and that nothing happens before it.
  effect: string
  approved: string
  rejected: string
  // For the turn's live region.
  waiting: string
}

// The approval card's words: a reprint request submits to production planning as the user; any other tool, should an
// agent hold one for approval, runs as them.
export function approvalCopy(approval: ApprovalRequest): ApprovalCopy {
  if (iqOf(approval.server) === 'action') {
    return {
      title: 'Approve this reprint request?',
      effect: 'Approving submits the request to production planning as you. Nothing is submitted until you approve.',
      approved: 'You approved this request.',
      rejected: 'You rejected this request. Nothing was submitted.',
      waiting: 'a reprint request needs your approval.',
    }
  }
  return {
    title: `Approve this ${approval.tool} call?`,
    effect: `Approving lets the agent run ${approval.tool} as you. Nothing runs until you approve.`,
    approved: 'You approved this call.',
    rejected: 'You rejected this call. Nothing ran.',
    waiting: `${approval.tool} needs your approval.`,
  }
}

const COUNT = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 2 })
const POUNDS = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', minimumFractionDigits: 0, maximumFractionDigits: 2 })

// A reprint request's arguments, in the order a person checks them.
const APPROVAL_FIELDS: readonly { name: string; label: string; money?: boolean }[] = [
  { name: 'edition_id', label: 'Edition' },
  { name: 'territory', label: 'Territory' },
  { name: 'quantity', label: 'Quantity' },
  { name: 'expedited', label: 'Expedited' },
  { name: 'investment_gbp', label: 'Investment', money: true },
  { name: 'signal_id', label: 'Signal' },
  { name: 'option_id', label: 'Option' },
  { name: 'rationale', label: 'Rationale' },
  { name: 'evidence', label: 'Evidence' },
]

function shown(value: ApprovalValue, money = false): string {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'number') return (money ? POUNDS : COUNT).format(value)
  return value ?? 'None'
}

// Every argument the agent proposed, labelled and formatted: the reprint request's fields first, then any other, so
// the card hides nothing the user approves.
export function approvalFields(approval: ApprovalRequest): { name: string; label: string; value: string }[] {
  const known = new Set(APPROVAL_FIELDS.map((field) => field.name))
  const fields = APPROVAL_FIELDS.filter((field) => Object.hasOwn(approval.arguments, field.name))
    .map((field) => ({ name: field.name, label: field.label, value: shown(approval.arguments[field.name], field.money) }))
  const others = Object.entries(approval.arguments).filter(([name]) => !known.has(name)).map(([name, value]) => ({
    name, label: name.replaceAll('_', ' ').replace(/^\w/, (first) => first.toUpperCase()), value: shown(value),
  }))
  return [...fields, ...others]
}

// A short, polite update for the turn's live region: each tool event, then the outcome.
export function announcement(turn: Turn, label: string): string {
  const result = turn.result
  if (turn.running || !result) {
    const last = turn.toolCalls.at(-1)
    if (!last) return `${label}: asking the agent.`
    const name = iqName(last.server) ?? last.tool
    return `${label}: ${name} ${last.state === 'running' ? 'started' : STATE_LABELS[last.state].toLowerCase()}.`
  }
  switch (result.status) {
    case 'answered':
      return `${label}: answer ready.`
    case 'needs-consent':
      return `${label}: ${iqName(result.server) ?? 'a tool'} needs your consent.`
    case 'needs-approval':
      return `${label}: ${approvalCopy(result.approval).waiting}`
    case 'failed':
      return result.code === CANCELLED ? `${label}: stopped.` : `${label}: ${result.message}`
  }
}
