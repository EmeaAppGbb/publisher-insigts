import { useEffect, useId, useRef, useState } from 'react'
import { approvalCopy, approvalFields } from '../labels.ts'
import type { ApprovalRequest } from '../live/types.ts'

interface ApprovalCardProps {
  approval: ApprovalRequest
  // The decision the thread's next turn sent, once the user has decided.
  decision?: boolean
  // Undefined when the request no longer waits for a decision.
  onDecide?: (approve: boolean) => void
}

// The free-text fields read best across the card.
const FULL = new Set(['rationale', 'evidence'])

function span(name: string, value: string): string {
  if (FULL.has(name) || value.length > 90) return 'evidence-card full'
  return value.length > 24 ? 'evidence-card wide' : 'evidence-card'
}

// A tool call Foundry holds until the user decides, as a decision card: every argument the agent proposed, as plain
// text, then Approve or Reject. The decision continues the same run as the thread's next turn; nothing runs before it.
export function ApprovalCard({ approval, decision, onDecide }: ApprovalCardProps) {
  const id = useId()
  const [chosen, setChosen] = useState<boolean>()
  const note = useRef<HTMLParagraphElement>(null)
  const decided = decision ?? chosen
  const copy = approvalCopy(approval)
  const closed = decided !== undefined || !onDecide
  // The pressed button is disabled at once, so focus moves to what the decision did rather than off the page.
  useEffect(() => {
    if (chosen !== undefined) note.current?.focus()
  }, [chosen])
  const decide = (approve: boolean) => {
    if (decided !== undefined || !onDecide) return
    setChosen(approve)
    onDecide(approve)
  }
  const [tag, tone] = decided === undefined
    ? (onDecide ? ['Your approval is needed', 'amber'] : ['No longer waiting', ''])
    : (decided ? ['Approved', 'green'] : ['Rejected', 'red'])
  return (
    <div className="decision-card" role="group" aria-labelledby={`${id}-title`} aria-describedby={`${id}-effect`}>
      <div className="decision-head">
        <span className={`tag ${tone}`}>{tag}</span>
        <span className="micro">Decision card · prepared by the agent</span>
      </div>
      <h4 id={`${id}-title`} className="h3">{copy.title}</h4>
      <dl className="evidence-cards approval-fields">
        {approvalFields(approval).map((field) => (
          <div key={field.name} className={span(field.name, field.value)}>
            <dt className="micro">{field.label}</dt>
            <dd>{field.value}</dd>
          </div>
        ))}
      </dl>
      <p id={`${id}-effect`} className="decision-effect">{copy.effect}</p>
      <div className="btn-row">
        <button type="button" className="btn primary" disabled={closed} onClick={() => decide(true)}>Approve</button>
        <button type="button" className="btn secondary" disabled={closed} onClick={() => decide(false)}>Reject</button>
      </div>
      {decided !== undefined && (
        <p ref={note} className="approval-note" tabIndex={-1}>{decided ? copy.approved : copy.rejected}</p>
      )}
    </div>
  )
}
