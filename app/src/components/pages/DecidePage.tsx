import { useId } from 'react'
import { latestExchange } from '../../exchanges.ts'
import { AnswerPanel, type StoryContext } from '../AnswerPanel.tsx'

// 03 Decide: the options, each from its row, and who may approve them.
export function DecidePage({ story }: { story: StoryContext }) {
  const id = useId()
  return (
    <>
      <p className="eyebrow">03 · Options &amp; authority</p>
      <h1 className="h2 page-title" tabIndex={-1}>What should we do?</h1>
      <p className="lede">
        Each option from its row, and the approver the decision authority matrix names. Intelligence informs the decision.
        People make it.
      </p>
      <AnswerPanel stage="decide" story={story} />
      <section aria-labelledby={`${id}-how`}>
        <div className="section-head">
          <div>
            <p className="eyebrow">How the agent builds it</p>
            <h2 id={`${id}-how`} className="h2">From rows and policy, not from memory.</h2>
          </div>
        </div>
        <div className="grid three">
          <article className="card soft">
            <h3 className="section-label">From the ontology</h3>
            <p className="card-copy">Each option’s cost, effect and timing, copied from its row.</p>
          </article>
          <article className="card soft">
            <h3 className="section-label">From the matrix</h3>
            <p className="card-copy">Who may approve, from the decision authority matrix (BKS-GOV-003).</p>
          </article>
          <article className="card soft">
            <h3 className="section-label">Never invented</h3>
            <p className="card-copy">The agent doesn’t total, round or estimate; a missing figure is said to be missing.</p>
          </article>
        </div>
      </section>
      <div className="btn-row page-actions">
        <button type="button" className="btn primary" onClick={() => story.go('act')}>
          Prepare the reprint request <span aria-hidden="true">→</span>
        </button>
        <button type="button" className="btn secondary" aria-haspopup="dialog" onClick={() => story.trust(latestExchange(story.exchanges, 'decide'))}>
          How I got this
        </button>
      </div>
    </>
  )
}
