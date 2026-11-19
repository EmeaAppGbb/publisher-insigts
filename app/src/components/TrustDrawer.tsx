import { Fragment, useId, type MouseEvent, type ReactNode } from 'react'
import type { Exchange, Thread, Turn } from '../exchanges.ts'
import { STATE_LABELS, VARIANT_DETAILS, VARIANT_LABELS, duration } from '../labels.ts'
import { IQ_NAMES, iqOf } from '../live/protocol.ts'
import { renderInline } from '../live/reply.ts'
import type { ParsedReply, SourceLine } from '../live/types.ts'
import { Legend } from './Legend.tsx'
import { useModalDialog } from './useModalDialog.ts'

const RULES = [
  'Read-only, except one approval-gated reprint request.',
  'Every question runs as you; the agent sees only what you may see.',
  'Web IQ searches hold public terms only.',
  'Figures are copied from rows, never totalled or estimated.',
]

function turnKind(turn: Turn, index: number): string {
  if (turn.approval) return turn.approval.approve ? 'decision, approved' : 'decision, rejected'
  return index === 0 ? 'question' : 'follow-up'
}

function replies(thread: Thread): ParsedReply[] {
  return thread.turns.flatMap((turn) => (!turn.running && turn.result?.status === 'answered' ? [turn.result.reply] : []))
}

// Each source line once, in the order the thread's answers listed them.
function sourcesOf(thread: Thread): SourceLine[] {
  const seen = new Set<string>()
  return replies(thread).flatMap((reply) => reply.sources).filter((source) => {
    const key = `${source.id}\n${source.text}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function Route({ thread, mode }: { thread: Thread; mode?: 'live' | 'mock' }) {
  const several = thread.turns.length > 1
  return (
    <div className="evidence-list">
      <div className="evidence-row"><b>Agent</b><span>{VARIANT_LABELS[thread.variant]} · {VARIANT_DETAILS[thread.variant]}</span></div>
      <div className="evidence-row">
        <b>Identity</b>
        <span>{mode === 'mock' ? 'Mock mode: canned answers, no sign-in' : 'Your Microsoft Entra token, checked by the app server and forwarded to Foundry'}</span>
      </div>
      {thread.turns.map((turn, index) => {
        const which = several ? `, ${turnKind(turn, index)}` : ''
        const result = turn.running ? undefined : turn.result
        return (
          <Fragment key={turn.id}>
            <div className="evidence-row"><b>Response{which}</b><span>{result ? (result.responseId ? <code>{result.responseId}</code> : '—') : 'Running…'}</span></div>
            <div className="evidence-row"><b>Time{which}</b><span>{result ? duration(result.elapsedMs) : 'Running…'}</span></div>
          </Fragment>
        )
      })}
    </div>
  )
}

function Calls({ thread }: { thread: Thread }) {
  const calls = thread.turns.flatMap((turn) => turn.toolCalls.map((call) => ({ key: `${turn.id}-${call.id}`, call })))
  if (!calls.length) return <p className="small muted">{thread.variant === 'without_iq' ? 'No tool calls: this agent has none.' : 'No tool calls yet.'}</p>
  return (
    <ol className="call-list">
      {calls.map(({ key, call }) => {
        const iq = iqOf(call.server)
        return (
          <li key={key} className="evidence-card">
            <div className="call-head">
              <span className={`tag iq-tag iq-${iq ?? 'other'}`}>{iq ? IQ_NAMES[iq] : call.server || 'Tool'}</span>
              <code className="tool-name">{call.tool}</code>
              <span className="micro">{STATE_LABELS[call.state]}{call.ms !== undefined && ` · ${duration(call.ms)}`}</span>
            </div>
            {call.arguments && (
              <>
                <p className="micro call-label">{iq === 'action' ? 'Request' : 'Query'}</p>
                <pre className="code-wrap"><code>{call.arguments}</code></pre>
              </>
            )}
            {call.error && <p className="tool-error">{call.error}</p>}
          </li>
        )
      })}
    </ol>
  )
}

function Ledger({ thread }: { thread: Thread }) {
  const sources = sourcesOf(thread)
  if (!sources.length) return <p className="small muted">No sources listed.</p>
  return (
    <ul className="ledger">
      {sources.map((source, index) => (
        <li key={index} className="evidence-card">
          <span className={`tag iq-tag iq-${source.kind}`}>{IQ_NAMES[source.kind]}</span>
          <p className="ledger-line"><span className={`cite cite-${source.kind}`}>{source.id}</span> {source.text}</p>
          {source.url && (
            <a className="ledger-link" href={source.url} target="_blank" rel="noopener noreferrer">
              Open<span className="visually-hidden"> {source.id} in a new tab</span>
            </a>
          )}
        </li>
      ))}
    </ul>
  )
}

function Steps({ thread }: { thread: Thread }) {
  const steps = replies(thread).flatMap((reply) => reply.steps)
  if (!steps.length) return <p className="small muted">No steps listed.</p>
  return (
    <ol className="drawer-steps">
      {steps.map((step, index) => <li key={index} dangerouslySetInnerHTML={{ __html: renderInline(step) }} />)}
    </ol>
  )
}

// One section, with each thread's part under its agent's name when two agents answered.
function Section({ title, exchange, children }: { title: string; exchange: Exchange; children: (thread: Thread) => ReactNode }) {
  const id = useId()
  const several = exchange.threads.length > 1
  return (
    <section className="drawer-section" aria-labelledby={id}>
      <h3 id={id} className="drawer-h">{title}</h3>
      {exchange.threads.map((thread) => (
        <div key={thread.id} className="drawer-group">
          {several && <p className="section-label">{VARIANT_LABELS[thread.variant]}</p>}
          {children(thread)}
        </div>
      ))}
    </section>
  )
}

interface TrustDrawerProps {
  open: boolean
  exchange?: Exchange
  mode?: 'live' | 'mock'
  onClose: () => void
}

// "How I got this": the route, tool calls, evidence and steps behind one exchange, then the rules every answer keeps.
export function TrustDrawer({ open, exchange, mode, onClose }: TrustDrawerProps) {
  const id = useId()
  const dialog = useModalDialog(open)
  // A click on the backdrop lands on the dialog itself; the panel fills the rest.
  const onBackdrop = (event: MouseEvent<HTMLDialogElement>) => {
    if (event.target === event.currentTarget) onClose()
  }
  return (
    <dialog ref={dialog} className="drawer" aria-labelledby={`${id}-title`} onClose={onClose} onClick={onBackdrop}>
      {open && (
        <div className="drawer-inner">
          <div className="drawer-head">
            <h2 id={`${id}-title`}>How I got this</h2>
            <button type="button" className="close-btn" aria-label="Close" onClick={onClose}>×</button>
          </div>
          {exchange ? (
            <>
              <div className="drawer-question">
                <p className="micro">The question</p>
                <p className="serif">{exchange.question}</p>
              </div>
              <Section title="The route" exchange={exchange}>{(thread) => <Route thread={thread} mode={mode} />}</Section>
              <Section title="Tool calls" exchange={exchange}>{(thread) => <Calls thread={thread} />}</Section>
              <Section title="Evidence ledger" exchange={exchange}>{(thread) => <Ledger thread={thread} />}</Section>
              <Section title="Steps" exchange={exchange}>{(thread) => <Steps thread={thread} />}</Section>
            </>
          ) : (
            <p className="empty-state">Ask this page’s question to see how the agent got its answer.</p>
          )}
          <section className="drawer-section" aria-labelledby={`${id}-rules`}>
            <h3 id={`${id}-rules`} className="drawer-h">Rules</h3>
            <ul className="rules">{RULES.map((rule) => <li key={rule}>{rule}</li>)}</ul>
          </section>
          <section className="drawer-section" aria-labelledby={`${id}-legend`}>
            <h3 id={`${id}-legend`} className="drawer-h">Source markers</h3>
            <Legend />
          </section>
        </div>
      )}
    </dialog>
  )
}
