import { useId } from 'react'
import { latestExchange } from '../../exchanges.ts'
import { runMetrics, withIqThread } from '../../story.ts'
import { AnswerPanel, type StoryContext } from '../AnswerPanel.tsx'
import { BookCard } from '../BookCard.tsx'
import { Legend } from '../Legend.tsx'

// 01 Signal: what the week's signal run marks material, explained live, beside the decision window.
export function SignalPage({ story }: { story: StoryContext }) {
  const id = useId()
  const metrics = runMetrics(withIqThread(latestExchange(story.exchanges, 'signal')))
  return (
    <>
      <p className="eyebrow">01 · Signal · Fictional portfolio</p>
      <h1 className="headline" tabIndex={-1}>A title is<br />breaking out.</h1>
      <p className="lede">The signal run marks what is material this week. The agent explains it, with a source for every fact.</p>
      <div className="home-hero">
        <AnswerPanel stage="signal" story={story} />
        <aside className="urgency" aria-labelledby={`${id}-window`}>
          <p className="urgency-mark"><i className="pulse" aria-hidden="true" /> Decision window</p>
          <div>
            <h2 id={`${id}-window`}>Momentum is real.<br />Its duration isn’t.</h2>
            <p>A reprint takes weeks to land. Act while the signal still matters, without overprinting a spike that fades.</p>
          </div>
          <p className="window">A human decision comes before any reprint</p>
          <button type="button" className="btn primary" onClick={() => story.go('understand')}>
            Understand the signal <span aria-hidden="true">→</span>
          </button>
        </aside>
      </div>
      <section aria-labelledby={`${id}-focus`}>
        <div className="section-head">
          <div>
            <p className="eyebrow">The title in focus</p>
            <h2 id={`${id}-focus`} className="h2">One work, several editions.</h2>
          </div>
        </div>
        <BookCard metrics={metrics} />
      </section>
      <section aria-labelledby={`${id}-reading`}>
        <div className="section-head">
          <div>
            <p className="eyebrow">Reading an answer</p>
            <h2 id={`${id}-reading`} className="h2">Every fact shows where it came from.</h2>
          </div>
        </div>
        <div className="grid three">
          <article className="card soft">
            <p className="micro">Markers</p>
            <h3 className="h3 card-title">Facts carry a marker</h3>
            <Legend />
          </article>
          <article className="card soft">
            <p className="micro">Web IQ</p>
            <h3 className="h3 card-title">Public stays public</h3>
            <p className="small muted">Web IQ context is labelled as public, never presented as company data.</p>
          </article>
          <article className="card soft">
            <p className="micro">Approval</p>
            <h3 className="h3 card-title">People decide</h3>
            <p className="small muted">The agent prepares. Only you approve the one change it can make.</p>
          </article>
        </div>
      </section>
    </>
  )
}
