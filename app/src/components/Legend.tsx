import { LEGEND } from '../labels.ts'
import { IQ_NAMES } from '../live/protocol.ts'

// What each source marker cites, as a chip in its IQ's colour.
export function Legend() {
  return (
    <dl className="legend" aria-label="Source markers">
      {LEGEND.map((entry) => (
        <div key={entry.marker}>
          <dt><span className={`cite cite-${entry.iq}`}>{entry.marker}</span></dt>
          <dd><strong>{IQ_NAMES[entry.iq]}</strong> {entry.what}</dd>
        </div>
      ))}
    </dl>
  )
}
