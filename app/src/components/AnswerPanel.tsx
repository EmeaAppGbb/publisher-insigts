import { useId, useRef, type RefObject } from 'react'
import { latestExchange, type Exchange } from '../exchanges.ts'
import { sample } from '../samples.ts'
import { STAGE_SAMPLES, type PageId, type Stage } from '../story.ts'
import { ThreadCard, type TurnActions } from './Exchange.tsx'

// What every story page needs from the app: the answers so far, why asking is blocked, and the ways to ask, compare,
// open the drawer and move on.
export interface StoryContext {
  exchanges: readonly Exchange[]
  mode?: 'live' | 'mock'
  // The signed-in user's name.
  user?: string
  blocked?: string
  actions: TurnActions
  ask: (stage: Stage) => void
  compare: (exchange: Exchange) => void
  trust: (exchange?: Exchange) => void
  go: (page: PageId) => void
}

interface AnswerPanelProps {
  stage: Stage
  story: StoryContext
  // For a page's own Ask button, which moves focus to the question too.
  headingRef?: RefObject<HTMLHeadingElement | null>
}

// One story page's live question: before it is asked, the question and the way to ask it; then the newest exchange
// of its stage, with the agent without IQ beside it once compared.
export function AnswerPanel({ stage, story, headingRef }: AnswerPanelProps) {
  const id = useId()
  const own = useRef<HTMLHeadingElement>(null)
  const heading = headingRef ?? own
  const { question, note } = sample(STAGE_SAMPLES[stage])
  const exchange = latestExchange(story.exchanges, stage)
  const running = exchange?.threads.some((thread) => thread.turns.at(-1)?.running) ?? false
  const compared = exchange?.threads.some((thread) => thread.variant === 'without_iq') ?? false
  // The pressed button goes away or is disabled, so focus moves to the question it asked.
  const ask = () => {
    story.ask(stage)
    heading.current?.focus()
  }
  const compare = () => {
    if (!exchange) return
    story.compare(exchange)
    heading.current?.focus()
  }
  return (
    <section className="card answer-panel" aria-labelledby={`${id}-question`}>
      <p className="micro">The question</p>
      <h2 id={`${id}-question`} ref={heading} tabIndex={-1} className="h3 answer-question">{exchange?.question ?? question}</h2>
      {note && <span className="chip-note">{note}</span>}
      {exchange ? (
        <>
          <div className={exchange.threads.length > 1 ? 'threads compare' : 'threads'}>
            {exchange.threads.map((thread) => <ThreadCard key={thread.id} thread={thread} actions={story.actions} />)}
          </div>
          <div className="btn-row answer-toolbar">
            <button type="button" className="btn secondary small-btn" disabled={Boolean(story.blocked) || running} onClick={ask}>Ask again</button>
            {!compared && (
              <button type="button" className="btn secondary small-btn" disabled={Boolean(story.blocked)} onClick={compare}>Compare without IQ</button>
            )}
            <button type="button" className="btn ghost small-btn" aria-haspopup="dialog" onClick={() => story.trust(exchange)}>How I got this</button>
          </div>
        </>
      ) : (
        <div className="answer-empty">
          <p>The agent with IQ answers as you. Each fact comes back with a marker for its source.</p>
          <div className="btn-row">
            <button type="button" className="btn primary" disabled={Boolean(story.blocked)} aria-describedby={story.blocked ? `${id}-blocked` : undefined} onClick={ask}>
              Ask the agent
            </button>
          </div>
          {story.blocked && <p id={`${id}-blocked`} className="hint blocked">{story.blocked}</p>}
        </div>
      )}
    </section>
  )
}
