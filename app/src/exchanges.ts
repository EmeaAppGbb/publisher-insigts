// The page's conversation state, kept pure so the UI only dispatches: each exchange is one question, asked of one
// agent or of both side by side; each thread holds one agent's turns, its follow-ups continuing the last answer, and
// a decision continuing a run that waits for the user's approval. A story page's exchange names its stage.
import type { ApprovalDecision, ApprovalRequest, Question, ToolCall, TurnResult, Variant } from './live/types.ts'
import type { Stage } from './story.ts'

export interface Turn {
  id: string
  // The question as asked; empty for a decision.
  question: string
  previousResponseId?: string
  // The user's decision on the approval request of the response this turn continues, sent instead of a question.
  approval?: ApprovalDecision
  // performance.now() when the turn (re)started.
  startedAt: number
  running: boolean
  toolCalls: ToolCall[]
  result?: TurnResult
}

export interface Thread {
  id: string
  variant: Variant
  turns: Turn[]
}

export interface Exchange {
  id: string
  question: string
  threads: Thread[]
  // The story stage that asked it; the Ask page's own questions have none.
  stage?: Stage
}

export type Action =
  | { type: 'ask'; exchange: Exchange }
  // Adds the other agent's thread to an exchange, such as the agent without IQ beside a story answer.
  | { type: 'thread'; exchangeId: string; thread: Thread }
  | { type: 'follow-up'; threadId: string; turn: Turn }
  | { type: 'restart'; turnId: string; startedAt: number }
  | { type: 'tool'; turnId: string; call: ToolCall }
  | { type: 'finish'; turnId: string; result: TurnResult }
  | { type: 'clear' }

export function newTurn(id: string, question: string, startedAt: number, previousResponseId?: string): Turn {
  return { id, question, startedAt, running: true, toolCalls: [], ...(previousResponseId ? { previousResponseId } : {}) }
}

// The newest exchange a story stage asked: the list is newest first, and asking again adds a newer one.
export function latestExchange(exchanges: readonly Exchange[], stage: Stage): Exchange | undefined {
  return exchanges.find((exchange) => exchange.stage === stage)
}

// The response a follow-up in this thread continues: the last turn's, once it has answered.
export function followUpFrom(thread: Thread): string | undefined {
  const last = thread.turns.at(-1)
  return last && !last.running && last.result?.status === 'answered' ? last.result.responseId : undefined
}

// The approval request the with-IQ thread's last turn waits on, with the response that holds it, until a decision.
export function pendingApproval(thread: Thread): { approval: ApprovalRequest; responseId: string } | undefined {
  const last = thread.turns.at(-1)
  const result = last && !last.running ? last.result : undefined
  return thread.variant === 'with_iq' && result?.status === 'needs-approval' ? { approval: result.approval, responseId: result.responseId } : undefined
}

// The turn that sends the user's decision on the thread's pending approval request, or undefined when none waits.
export function decisionTurn(thread: Thread, approve: boolean, id: string, startedAt: number): Turn | undefined {
  const pending = pendingApproval(thread)
  return pending && { ...newTurn(id, '', startedAt, pending.responseId), approval: { id: pending.approval.id, approve } }
}

// The decision a later turn of the thread sent on this turn's approval request, once the user has decided.
export function decisionOn(thread: Thread, turn: Turn): boolean | undefined {
  const result = turn.result
  if (result?.status !== 'needs-approval') return undefined
  return thread.turns.find((later) => later.approval?.id === result.approval.id)?.approval?.approve
}

// What a turn sends its agent: its question, or the decision on the approval request of the response it continues.
export function questionOf(thread: Thread, turn: Turn): Question {
  const { approval, previousResponseId } = turn
  if (approval && previousResponseId) return { variant: 'with_iq', approval, previousResponseId }
  return { variant: thread.variant, text: turn.question, ...(previousResponseId ? { previousResponseId } : {}) }
}

function mapTurns(state: Exchange[], update: (turn: Turn, thread: Thread) => Turn): Exchange[] {
  return state.map((exchange) => ({
    ...exchange,
    threads: exchange.threads.map((thread) => ({ ...thread, turns: thread.turns.map((turn) => update(turn, thread)) })),
  }))
}

function withCall(calls: readonly ToolCall[], call: ToolCall): ToolCall[] {
  return calls.some((existing) => existing.id === call.id)
    ? calls.map((existing) => (existing.id === call.id ? call : existing))
    : [...calls, call]
}

export function reduce(state: Exchange[], action: Action): Exchange[] {
  switch (action.type) {
    case 'ask':
      return [action.exchange, ...state]
    case 'thread':
      return state.map((exchange) => (exchange.id === action.exchangeId && !exchange.threads.some((thread) => thread.variant === action.thread.variant)
        ? { ...exchange, threads: [...exchange.threads, action.thread] }
        : exchange))
    case 'follow-up':
      return state.map((exchange) => ({
        ...exchange,
        threads: exchange.threads.map((thread) => (thread.id === action.threadId ? { ...thread, turns: [...thread.turns, action.turn] } : thread)),
      }))
    case 'restart':
      return mapTurns(state, (turn) => (turn.id === action.turnId
        ? {
            id: turn.id, question: turn.question, startedAt: action.startedAt, running: true, toolCalls: [],
            ...(turn.previousResponseId ? { previousResponseId: turn.previousResponseId } : {}),
            ...(turn.approval ? { approval: turn.approval } : {}),
          }
        : turn))
    case 'tool':
      return mapTurns(state, (turn) => (turn.id === action.turnId && turn.running ? { ...turn, toolCalls: withCall(turn.toolCalls, action.call) } : turn))
    case 'finish':
      return mapTurns(state, (turn) => (turn.id === action.turnId
        ? { ...turn, running: false, result: action.result, toolCalls: action.result.toolCalls }
        : turn))
    case 'clear':
      return []
  }
}
