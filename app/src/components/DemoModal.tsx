import { useId, type MouseEvent } from 'react'
import { STEPS } from '../story.ts'
import { useModalDialog } from './useModalDialog.ts'

interface DemoModalProps {
  open: boolean
  mode?: 'live' | 'mock'
  // Why asking is unavailable, such as before sign-in.
  blocked?: string
  onClose: () => void
  onStart: () => void
  onNext: () => void
  onPrevious: () => void
  onAskAll: () => void
  onClear: () => void
}

// The presenter's controls: the guided story, every story answer at once or none, and which mode the app runs in.
export function DemoModal({ open, mode, blocked, onClose, onStart, onNext, onPrevious, onAskAll, onClear }: DemoModalProps) {
  const id = useId()
  const dialog = useModalDialog(open)
  const onBackdrop = (event: MouseEvent<HTMLDialogElement>) => {
    if (event.target === event.currentTarget) onClose()
  }
  return (
    <dialog ref={dialog} className="modal" aria-labelledby={`${id}-title`} onClose={onClose} onClick={onBackdrop}>
      {open && (
        <div className="modal-inner">
          <div className="drawer-head">
            <h2 id={`${id}-title`}>Demo control</h2>
            <button type="button" className="close-btn" aria-label="Close" onClick={onClose}>×</button>
          </div>
          <p className="small muted">Presenter tools for the guided story. Each step asks its page’s question unless it has an answer.</p>
          <section className="card soft modal-card" aria-labelledby={`${id}-story`}>
            <h3 id={`${id}-story`} className="section-label">Guided story</h3>
            <p className="small story-path">{STEPS.map((step) => step.label).join(' → ')}</p>
            <div className="btn-row">
              <button type="button" className="btn primary" onClick={onStart}>Start guided story</button>
              <button type="button" className="btn secondary" onClick={onNext}>Next step</button>
              <button type="button" className="btn secondary" onClick={onPrevious}>Previous step</button>
            </div>
            <p className="micro">{STEPS.length} steps</p>
          </section>
          <section className="card modal-card" aria-labelledby={`${id}-answers`}>
            <h3 id={`${id}-answers`} className="section-label">Answers</h3>
            <p className="small muted">Ask every story page’s question that has no answer yet, or clear all answers and stop the questions still running.</p>
            <div className="btn-row">
              <button type="button" className="btn primary" disabled={Boolean(blocked)} aria-describedby={blocked ? `${id}-blocked` : undefined} onClick={onAskAll}>
                Ask the whole story now
              </button>
              <button type="button" className="btn secondary" onClick={onClear}>Clear all answers</button>
            </div>
            {blocked && <p id={`${id}-blocked`} className="hint blocked">{blocked}</p>}
          </section>
          <section className="card modal-card" aria-labelledby={`${id}-mode`}>
            <h3 id={`${id}-mode`} className="section-label">Mode</h3>
            <p className="small muted">
              {mode === 'mock' ? 'Mock mode: canned answers, no sign-in, no Azure.' : 'Live: each question runs a Foundry agent as you.'}
            </p>
          </section>
          <div className="rule" />
          <p className="source">Fictional demo · all information synthetic</p>
        </div>
      )}
    </dialog>
  )
}
