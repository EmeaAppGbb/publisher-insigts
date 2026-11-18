import { useId } from 'react'
import { IQ_NAMES } from '../live/protocol.ts'
import type { IqKey } from '../live/types.ts'
import type { IqStats } from '../story.ts'
import { useModalDialog } from './useModalDialog.ts'

const CARDS: readonly { iq: Exclude<IqKey, 'action'>; text: string }[] = [
  { iq: 'work', text: 'What your team knows: your mail, read as you.' },
  { iq: 'fabric', text: 'What the business knows: the live ontology of sales, stock, signals and options.' },
  { iq: 'foundry', text: 'What approved policy says: the governed documents.' },
  { iq: 'web', text: 'What the outside world signals: public context, in public terms only.' },
]

const counted = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`

// The full-screen reveal behind the story: the four IQs, with what each did in this session.
export function Reveal({ open, stats, onClose }: { open: boolean; stats: IqStats; onClose: () => void }) {
  const id = useId()
  const dialog = useModalDialog(open)
  return (
    <dialog ref={dialog} className="reveal" aria-labelledby={`${id}-title`} onClose={onClose}>
      {open && (
        <div className="reveal-inner">
          <p className="eyebrow">Behind the story · live in this session</p>
          <h2 id={`${id}-title`}>Shared enterprise context.</h2>
          <p className="reveal-lede">
            Four IQs connect business facts, approved knowledge, the team’s mail and outside signals. People stay accountable
            for the decision.
          </p>
          <div className="iq-grid">
            {CARDS.map((card) => (
              <article key={card.iq} className="iq-card">
                <h3>{IQ_NAMES[card.iq]}</h3>
                <p>{card.text}</p>
                <p className="iq-live">
                  {counted(stats[card.iq].calls, 'call', 'calls')} · {counted(stats[card.iq].sources, 'source', 'sources')} this session
                </p>
              </article>
            ))}
          </div>
          <ol className="architecture" aria-label="The route of every question">
            <li className="arch-node">Your question</li>
            <li className="arch-arrow" aria-hidden="true">→</li>
            <li className="arch-node accent">The agent, as you</li>
            <li className="arch-arrow" aria-hidden="true">→</li>
            <li className="arch-node">Cited answer · your approval</li>
          </ol>
          <button type="button" className="btn primary" onClick={onClose}>Close</button>
        </div>
      )}
    </dialog>
  )
}
