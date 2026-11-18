import { useId, useRef } from 'react'
import { latestExchange } from '../../exchanges.ts'
import { PIPELINE_TITLES, pipelineState, type PipelineState } from '../../story.ts'
import { AnswerPanel, type StoryContext } from '../AnswerPanel.tsx'

const PIPELINE = ['Signal', 'Option', 'Policy', 'Your approval', 'Recorded']

// How far each state lit the pipeline: the steps done, then the one in progress or the one the decision stopped.
const PROGRESS: Readonly<Record<PipelineState, { done: number; active?: number; stopped?: number }>> = {
  none: { done: 0 },
  preparing: { done: 0, active: 0 },
  consent: { done: 0, active: 0 },
  awaiting: { done: 3, active: 3 },
  submitting: { done: 4, active: 4 },
  recorded: { done: 5 },
  rejected: { done: 3, stopped: 3 },
  unconfirmed: { done: 4, stopped: 4 },
  'not-submitted': { done: 0 },
}

const STEP_NOTES = { done: ', done', active: ', in progress', stopped: ', stopped', todo: '' }

// 04 Act: the one change the agent may make, prepared by it and decided by you.
export function ActPage({ story }: { story: StoryContext }) {
  const id = useId()
  const heading = useRef<HTMLHeadingElement>(null)
  const exchange = latestExchange(story.exchanges, 'act')
  const state = pipelineState(exchange)
  const progress = PROGRESS[state]
  const hint = story.blocked ?? (exchange ? 'The agent’s answer is below, with your decision card when it holds the request.' : undefined)
  const prepare = () => {
    story.ask('act')
    heading.current?.focus()
  }
  const identity = story.mode === 'mock'
    ? 'Mock mode: your decision plays a canned answer.'
    : `${story.user ? `Signed in as ${story.user}. ` : ''}The reprint server checks your approval role, not this page.`
  return (
    <>
      <p className="eyebrow">04 · Governed action</p>
      <h1 className="h2 page-title" tabIndex={-1}>Who needs to decide?</h1>
      <p className="lede">
        The agent can make one change: a reprint request. It proposes the option’s exact values; you approve or reject them
        here; the reprint server checks your role before it records anything.
      </p>
      <div className="grid two act-grid">
        <section className="card accent" aria-labelledby={`${id}-request`}>
          <span className="tag orange">Material publishing commitment</span>
          <h2 id={`${id}-request`} className="h3 card-heading">An expedited reprint, prepared by the agent</h2>
          <p className="small muted">
            The agent with IQ reads the week’s inventory risk and its recommended option, then holds the request for your
            decision.
          </p>
          <div className="btn-row">
            <button type="button" className="btn primary" disabled={Boolean(story.blocked) || Boolean(exchange)} aria-describedby={hint ? `${id}-hint` : undefined} onClick={prepare}>
              Prepare the request <span aria-hidden="true">→</span>
            </button>
            <button type="button" className="btn secondary" aria-haspopup="dialog" onClick={() => story.trust(exchange)}>How I got this</button>
          </div>
          {hint && <p id={`${id}-hint`} className={story.blocked ? 'hint blocked' : 'hint'}>{hint}</p>}
        </section>
        <section className="card dark governance" aria-labelledby={`${id}-state`}>
          <p className="micro">Governance</p>
          <h2 id={`${id}-state`} className="h3 card-heading">{PIPELINE_TITLES[state]}</h2>
          <ol className="pipeline">
            {PIPELINE.map((label, index) => {
              const step = index < progress.done ? 'done' : index === progress.active ? 'active' : index === progress.stopped ? 'stopped' : 'todo'
              return <li key={label} className={step}>{label}<span className="visually-hidden">{STEP_NOTES[step]}</span></li>
            })}
          </ol>
          <div className="bar" aria-hidden="true"><span className={`bar-${progress.done}`} /></div>
          {state === 'unconfirmed' ? (
            <p className="small">
              The answer below says what happened. Asking again is safe: the reprint server records at most one request per
              inventory risk, and returns the one it has.
            </p>
          ) : (
            <p className="small">Nothing is submitted until you approve. The server refuses a role, a value or a week that doesn’t match.</p>
          )}
        </section>
      </div>
      <AnswerPanel stage="act" story={story} headingRef={heading} />
      <p className="small muted act-identity">{identity}</p>
      <section className="card soft" aria-labelledby={`${id}-authority`}>
        <h2 id={`${id}-authority`} className="section-label">Authority</h2>
        <p className="card-copy">
          The decision authority matrix (BKS-GOV-003) names who may approve which reprint. The reprint server checks your
          Entra app role against it, then records the request in the BookSignals KQL database as its own identity.
        </p>
      </section>
    </>
  )
}
