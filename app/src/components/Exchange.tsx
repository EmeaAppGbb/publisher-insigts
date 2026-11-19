import { useEffect, useId, useState, type FormEvent } from 'react'
import { decisionOn, followUpFrom, pendingApproval, type Exchange, type Thread, type Turn } from '../exchanges.ts'
import { VARIANT_DETAILS, VARIANT_LABELS, announcement, duration, iqName } from '../labels.ts'
import { QUESTION_LIMIT, iqOf } from '../live/protocol.ts'
import { UNAUTHORIZED } from '../live/stream.ts'
import { CANCELLED } from '../live/turn.ts'
import type { TurnResult } from '../live/types.ts'
import { STAGE_LABELS } from '../story.ts'
import { ApprovalCard } from './ApprovalCard.tsx'
import { Reply } from './Reply.tsx'
import { ToolTimeline } from './ToolTimeline.tsx'

export interface TurnActions {
  onFollowUp: (thread: Thread, question: string) => void
  // The user's decision on the approval request the thread waits on.
  onDecide: (thread: Thread, approve: boolean) => void
  onRetry: (thread: Thread, turn: Turn) => void
  onStop: (turn: Turn) => void
  onSignIn: () => void
}

// Whole seconds since the turn started, ticking while it runs.
function useSeconds(startedAt: number): number {
  const [now, setNow] = useState(startedAt)
  useEffect(() => {
    const timer = setInterval(() => setNow(performance.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  return Math.max(0, Math.floor((now - startedAt) / 1000))
}

function Running({ turn, onStop }: { turn: Turn; onStop: () => void }) {
  const seconds = useSeconds(turn.startedAt)
  const toolRunning = turn.toolCalls.some((call) => call.state === 'running')
  return (
    <div className="running">
      {!toolRunning && <span className="spinner" aria-hidden="true" />}
      <span>{toolRunning ? 'Waiting for a tool' : 'Asking the agent'} · {seconds} s</span>
      <button type="button" className="btn ghost small-btn" onClick={onStop}>Stop</button>
    </div>
  )
}

interface OutcomeProps {
  result: TurnResult
  turnId: string
  onRetry: () => void
  onSignIn: () => void
  // For an approval request: the decision sent on it, or the way to send one while it waits.
  decision?: boolean
  onDecide?: (approve: boolean) => void
}

function Outcome({ result, turnId, onRetry, onSignIn, decision, onDecide }: OutcomeProps) {
  switch (result.status) {
    case 'answered':
      return <Reply reply={result.reply} turnId={turnId} />
    case 'needs-consent': {
      const name = iqName(result.server)
      // The reprint request acts as the user, where each IQ only reads.
      const access = result.server && iqOf(result.server) === 'action' ? 'submit requests' : 'read data'
      return (
        <div className="notice consent">
          <p>
            <strong>{name ?? 'This tool'} needs your consent.</strong> Authorize it once, in the new tab, to {access} as
            you; then ask again.
          </p>
          <div className="btn-row">
            <a className="btn primary small-btn" href={result.consentUrl} target="_blank" rel="noopener noreferrer">
              Authorize {name ?? 'tool'} access
            </a>
            <button type="button" className="btn secondary small-btn" onClick={onRetry}>Ask again</button>
          </div>
        </div>
      )
    }
    case 'needs-approval':
      return <ApprovalCard approval={result.approval} decision={decision} onDecide={onDecide} />
    case 'failed':
      return (
        <div className={result.code === CANCELLED ? 'notice' : 'notice error'}>
          <p>{result.code === CANCELLED ? 'Stopped before the agent answered.' : result.message}</p>
          <div className="btn-row">
            {result.code === UNAUTHORIZED
              ? <button type="button" className="btn primary small-btn" onClick={onSignIn}>Sign in again</button>
              : <button type="button" className="btn secondary small-btn" onClick={onRetry}>Ask again</button>}
          </div>
        </div>
      )
  }
}

function TurnView({ thread, turn, first, actions }: { thread: Thread; turn: Turn; first: boolean; actions: TurnActions }) {
  const result = turn.running ? undefined : turn.result
  const waiting = result?.status === 'needs-approval' && pendingApproval(thread)?.approval.id === result.approval.id
  return (
    <div className="turn" aria-busy={turn.running}>
      {!first && (turn.approval
        ? <p className="follow-up-question"><span>Decision</span> {turn.approval.approve ? 'Approved' : 'Rejected'}</p>
        : <p className="follow-up-question"><span>Follow-up</span> {turn.question}</p>)}
      {turn.toolCalls.length > 0 && <ToolTimeline calls={turn.toolCalls} />}
      {turn.running && <Running turn={turn} onStop={() => actions.onStop(turn)} />}
      {result && (
        <>
          <Outcome
            result={result}
            turnId={turn.id}
            onRetry={() => actions.onRetry(thread, turn)}
            onSignIn={actions.onSignIn}
            decision={decisionOn(thread, turn)}
            onDecide={waiting ? (approve) => actions.onDecide(thread, approve) : undefined}
          />
          <p className="meta">
            {result.responseId && <span>Response <code>{result.responseId}</code></span>}
            <span>{duration(result.elapsedMs)}</span>
          </p>
        </>
      )}
      <p className="visually-hidden" role="status">{announcement(turn, VARIANT_LABELS[thread.variant])}</p>
    </div>
  )
}

function FollowUp({ thread, onFollowUp }: { thread: Thread; onFollowUp: TurnActions['onFollowUp'] }) {
  const [text, setText] = useState('')
  const id = useId()
  const submit = (event: FormEvent) => {
    event.preventDefault()
    const question = text.trim()
    if (!question) return
    onFollowUp(thread, question)
    setText('')
  }
  return (
    <form className="follow-up" onSubmit={submit}>
      <label htmlFor={id} className="visually-hidden">Follow-up question ({VARIANT_LABELS[thread.variant]})</label>
      <input id={id} type="text" value={text} onChange={(event) => setText(event.target.value)} maxLength={QUESTION_LIMIT} placeholder="Ask a follow-up…" />
      <button type="submit" className="btn secondary small-btn" disabled={!text.trim()}>Follow up</button>
    </form>
  )
}

const STATUS_LABELS: Record<'running' | TurnResult['status'], string> = {
  running: 'Working',
  answered: 'Answered',
  'needs-consent': 'Needs consent',
  'needs-approval': 'Needs approval',
  failed: 'Not answered',
}

export function ThreadCard({ thread, actions }: { thread: Thread; actions: TurnActions }) {
  const id = useId()
  const last = thread.turns.at(-1)
  const status = !last || last.running ? 'running' : last.result?.status ?? 'running'
  return (
    <section className={`thread thread-${thread.variant}`} aria-labelledby={id}>
      <header className="thread-head">
        <h3 id={id}>{VARIANT_LABELS[thread.variant]}</h3>
        <span className="thread-detail">{VARIANT_DETAILS[thread.variant]}</span>
        <span className={`tag state state-${status}`}>{STATUS_LABELS[status]}</span>
      </header>
      {thread.turns.map((turn, index) => <TurnView key={turn.id} thread={thread} turn={turn} first={index === 0} actions={actions} />)}
      {followUpFrom(thread) && <FollowUp thread={thread} onFollowUp={actions.onFollowUp} />}
    </section>
  )
}

interface ExchangeViewProps {
  exchange: Exchange
  actions: TurnActions
  onTrust: (exchange: Exchange) => void
}

export function ExchangeView({ exchange, actions, onTrust }: ExchangeViewProps) {
  const id = useId()
  return (
    <article className="exchange" aria-labelledby={id}>
      <div className="exchange-head">
        <h2 id={id} className="question">{exchange.question}</h2>
        <div className="btn-row">
          {exchange.stage && <span className="tag">Asked on {STAGE_LABELS[exchange.stage]}</span>}
          <button type="button" className="btn ghost small-btn" aria-haspopup="dialog" onClick={() => onTrust(exchange)}>How I got this</button>
        </div>
      </div>
      <div className={exchange.threads.length > 1 ? 'threads compare' : 'threads'}>
        {exchange.threads.map((thread) => <ThreadCard key={thread.id} thread={thread} actions={actions} />)}
      </div>
    </article>
  )
}
