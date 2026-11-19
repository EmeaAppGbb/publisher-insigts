import { STEPS } from '../story.ts'

interface GuidedBarProps {
  step: number
  onPrevious: () => void
  onNext: () => void
}

// The guided story's position and its controls. Previous stays focusable on the first step, so focus never drops.
export function GuidedBar({ step, onPrevious, onNext }: GuidedBarProps) {
  const first = step === 0
  return (
    <section className="guided-bar" aria-label="Guided story">
      <p className="guided-title">
        <span className="micro">Guided story</span>
        <strong>{STEPS[step].label}</strong>
        <span className="small">Step {step + 1} of {STEPS.length}</span>
      </p>
      <div className="guided-dots" aria-hidden="true">
        {STEPS.map((entry, index) => <i key={entry.label} className={index === step ? 'active' : index < step ? 'done' : undefined} />)}
      </div>
      <div className="btn-row">
        <button type="button" className="btn secondary small-btn" aria-disabled={first} onClick={first ? undefined : onPrevious}>
          <span aria-hidden="true">←</span> Previous
        </button>
        <button type="button" className="btn primary small-btn" onClick={onNext}>
          {step === STEPS.length - 1 ? 'Finish story' : 'Next step'} <span aria-hidden="true">→</span>
        </button>
      </div>
    </section>
  )
}
