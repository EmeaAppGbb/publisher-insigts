import { useId } from 'react'
import { latestExchange } from '../../exchanges.ts'
import { ladderState } from '../../story.ts'
import { AnswerPanel, type StoryContext } from '../AnswerPanel.tsx'

const CONTRACT = [
  { title: 'Recorded', text: 'The reprint server writes the request to the BookSignals KQL database as soon as you approve.' },
  { title: 'Copied', text: 'The next signal run copies it into the lakehouse, insert-only.' },
  { title: 'Actioned', text: 'The inventory risk it covers is then marked Actioned, which the ontology shows.' },
]

// 05 Measure: what this session's decision became, and the live answer that shows whether the risk is actioned.
export function MeasurePage({ story, onReveal }: { story: StoryContext; onReveal: () => void }) {
  const id = useId()
  return (
    <>
      <p className="eyebrow">05 · Outcome &amp; accountability</p>
      <h1 className="h2 page-title" tabIndex={-1}>Did the decision land?</h1>
      <p className="lede">
        Approval isn’t the outcome. The request is recorded at once; the next signal run copies it into the lakehouse and
        marks the risk it covers actioned. Only then does the ontology show it.
      </p>
      <section className="card soft ladder-card" aria-labelledby={`${id}-ladder`}>
        <span className="tag">Measured in this session</span>
        <h2 id={`${id}-ladder`} className="h3 card-heading">Four stages. No shortcuts.</h2>
        <ol className="value-ladder">
          {ladderState(story.exchanges).map((stage) => (
            <li key={stage.id} className={`value-stage ${stage.status}`} aria-current={stage.status === 'active' ? 'step' : undefined}>
              <h3>{stage.label}</h3>
              <strong className={stage.value.length > 12 ? 'long' : undefined}>{stage.value}</strong>
              <p>{stage.description}</p>
            </li>
          ))}
        </ol>
      </section>
      <AnswerPanel stage="measure" story={story} />
      <section aria-labelledby={`${id}-contract`}>
        <div className="section-head">
          <div>
            <p className="eyebrow">The measurement contract</p>
            <h2 id={`${id}-contract`} className="h2">What must be true to claim it?</h2>
          </div>
        </div>
        <div className="grid three">
          {CONTRACT.map((item) => (
            <article key={item.title} className="card soft">
              <h3 className="contract-title">{item.title}</h3>
              <p className="small muted">{item.text}</p>
            </article>
          ))}
        </div>
      </section>
      <div className="btn-row page-actions">
        <button type="button" className="btn primary" aria-haspopup="dialog" onClick={onReveal}>
          Reveal the intelligence <span aria-hidden="true">→</span>
        </button>
        <button type="button" className="btn secondary" aria-haspopup="dialog" onClick={() => story.trust(latestExchange(story.exchanges, 'measure'))}>
          How I got this
        </button>
      </div>
    </>
  )
}
