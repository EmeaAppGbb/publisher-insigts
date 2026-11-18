import { useId } from 'react'
import { duration } from '../labels.ts'
import type { RunMetrics } from '../story.ts'

const count = (value: number | undefined) => (value === undefined ? '—' : String(value))

// The fictional focus title, with a CSS cover, and what the Signal answer's own run measured.
export function BookCard({ metrics }: { metrics?: RunMetrics }) {
  const id = useId()
  return (
    <article className="book-card" aria-labelledby={id}>
      <div className="book-cover" role="img" aria-label="Cover of The Glass Orchard by Mara Ellison, a fictional title">
        <span className="cover-publisher">Harrowgate Lane</span>
        <span className="cover-title">The<br />Glass<br />Orchard</span>
        <span className="cover-author">Mara Ellison</span>
        <span className="fictional-stamp">Fictional title</span>
      </div>
      <div className="book-copy">
        <span className="tag orange">Literary fiction · Harrowgate Lane</span>
        <h3 id={id}>The Glass Orchard</h3>
        <p className="author">Mara Ellison · Harrowgate Lane</p>
        <p className="small muted book-blurb">
          Shortlisted, selling ahead of plan, printed in hardback, with an ebook and audio edition. The live answers say by
          how much, and whether the hardback lasts until a reprint lands.
        </p>
        <dl className="metric-strip">
          <div className="metric"><dt>Sources cited</dt><dd>{count(metrics?.sources)}</dd></div>
          <div className="metric"><dt>IQ calls</dt><dd>{count(metrics?.calls)}</dd></div>
          <div className="metric"><dt>IQs used</dt><dd>{count(metrics?.iqs)}</dd></div>
          <div className="metric"><dt>Answered in</dt><dd>{metrics ? duration(metrics.elapsedMs) : '—'}</dd></div>
        </dl>
        <p className="micro metric-note">Measured from this answer’s run</p>
      </div>
    </article>
  )
}
