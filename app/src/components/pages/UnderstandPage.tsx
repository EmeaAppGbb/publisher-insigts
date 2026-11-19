import { useId, useRef, type KeyboardEvent } from 'react'
import { latestExchange } from '../../exchanges.ts'
import { LEGEND } from '../../labels.ts'
import { IQ_NAMES } from '../../live/protocol.ts'
import { sample } from '../../samples.ts'
import { STAGE_SAMPLES, UNDERSTAND_TABS, type UnderstandStage } from '../../story.ts'
import { AnswerPanel, type StoryContext } from '../AnswerPanel.tsx'

interface UnderstandPageProps {
  story: StoryContext
  tab: UnderstandStage
  onTab: (tab: UnderstandStage) => void
}

const KEYS: Readonly<Record<string, (index: number, last: number) => number>> = {
  ArrowRight: (index, last) => (index === last ? 0 : index + 1),
  ArrowLeft: (index, last) => (index === 0 ? last : index - 1),
  Home: () => 0,
  End: (_index, last) => last,
}

// 02 Understand: one tab per IQ, each with its own live question.
export function UnderstandPage({ story, tab, onTab }: UnderstandPageProps) {
  const id = useId()
  const tabs = useRef<(HTMLButtonElement | null)[]>([])
  const index = Math.max(0, UNDERSTAND_TABS.findIndex((entry) => entry.stage === tab))
  const current = UNDERSTAND_TABS[index]
  const marker = LEGEND.find((entry) => entry.iq === current.iq)?.marker
  // Arrow keys move between tabs and open them, as the ARIA tabs pattern does.
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, from: number) => {
    const move = KEYS[event.key]
    if (!move) return
    event.preventDefault()
    const next = move(from, UNDERSTAND_TABS.length - 1)
    onTab(UNDERSTAND_TABS[next].stage)
    tabs.current[next]?.focus()
  }
  return (
    <>
      <p className="eyebrow">02 · Evidence · Four IQs</p>
      <h1 className="h2 page-title" tabIndex={-1}>Why is The Glass Orchard moving?</h1>
      <p className="lede">Each kind of evidence comes from its own IQ, read as you. Facts carry their source; public context stays labelled public.</p>
      <div className="tabs" role="tablist" aria-label="Evidence by IQ">
        {UNDERSTAND_TABS.map((entry, position) => {
          const selected = position === index
          const note = sample(STAGE_SAMPLES[entry.stage]).note
          return (
            <button
              key={entry.stage}
              ref={(element) => { tabs.current[position] = element }}
              type="button"
              role="tab"
              id={`${id}-tab-${position}`}
              aria-selected={selected}
              aria-controls={`${id}-panel`}
              tabIndex={selected ? 0 : -1}
              className="tab"
              onClick={() => onTab(entry.stage)}
              onKeyDown={(event) => onKeyDown(event, position)}
            >
              {entry.label}
              {note && <span className="tab-note">{note}</span>}
            </button>
          )
        })}
      </div>
      <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-tab-${index}`} className="understand-grid">
        <AnswerPanel stage={current.stage} story={story} />
        <div className="card soft iq-knows">
          <h2 className="section-label">What this IQ knows</h2>
          <span className={`tag iq-tag iq-${current.iq}`}>{IQ_NAMES[current.iq]}</span>
          <p className="iq-knows-text">{current.knows}</p>
          {marker && (
            <p className="small muted">
              Its facts carry a <span className={`cite cite-${current.iq}`}>{marker}</span> marker, and the Sources list names each one.
            </p>
          )}
        </div>
      </div>
      <div className="btn-row page-actions">
        <button type="button" className="btn primary" onClick={() => story.go('decide')}>
          Compare the options <span aria-hidden="true">→</span>
        </button>
        <button type="button" className="btn secondary" aria-haspopup="dialog" onClick={() => story.trust(latestExchange(story.exchanges, current.stage))}>
          How I got this
        </button>
      </div>
    </>
  )
}
