import { useId, useState, type FormEvent, type KeyboardEvent } from 'react'
import { CHOICES, CHOICE_HINTS, type Choice } from '../labels.ts'
import { QUESTION_LIMIT } from '../live/protocol.ts'
import { SAMPLES } from '../samples.ts'
import { Legend } from './Legend.tsx'

interface ComposerProps {
  // Why asking is unavailable, such as before sign-in; undefined when the user can ask.
  blocked?: string
  onAsk: (question: string, choice: Choice) => void
}

export function Composer({ blocked, onAsk }: ComposerProps) {
  const [text, setText] = useState('')
  const [choice, setChoice] = useState<Choice>('with_iq')
  const id = useId()
  const question = text.trim()
  const submit = (event?: FormEvent) => {
    event?.preventDefault()
    if (blocked || !question) return
    onAsk(question, choice)
    setText('')
  }
  // Enter asks; Shift+Enter starts a new line.
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      submit()
    }
  }
  return (
    <section className="card composer" aria-labelledby={`${id}-label`}>
      <form onSubmit={submit}>
        <label id={`${id}-label`} htmlFor={`${id}-question`} className="composer-label">
          Ask about the fictional book portfolio
        </label>
        <textarea
          id={`${id}-question`}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
          maxLength={QUESTION_LIMIT}
          rows={3}
          placeholder="Which titles need attention this week, and why?"
          aria-describedby={`${id}-hint`}
        />
        <div className="composer-bar">
          <fieldset className="segmented">
            <legend className="visually-hidden">Which agent to ask</legend>
            {CHOICES.map((option) => (
              <label key={option.value}>
                <input
                  type="radio"
                  name={`${id}-variant`}
                  value={option.value}
                  checked={choice === option.value}
                  onChange={() => setChoice(option.value)}
                />
                <span>{option.label}</span>
              </label>
            ))}
          </fieldset>
          <span className="count" aria-hidden="true">{text.length} / {QUESTION_LIMIT}</span>
          <button type="submit" className="btn primary" disabled={Boolean(blocked) || !question}>Ask</button>
        </div>
        <p id={`${id}-hint`} className={blocked ? 'hint blocked' : 'hint'}>{blocked ?? CHOICE_HINTS[choice]}</p>
      </form>
      <div className="samples">
        <h2 id={`${id}-samples`} className="section-label">Sample questions</h2>
        <ul aria-labelledby={`${id}-samples`}>
          {SAMPLES.map((sample) => (
            <li key={sample.question}>
              <button type="button" className="chip" disabled={Boolean(blocked)} onClick={() => onAsk(sample.question, choice)}>
                {sample.question}
                {sample.note && <span className="chip-note">{sample.note}</span>}
              </button>
            </li>
          ))}
        </ul>
      </div>
      <Legend />
    </section>
  )
}
