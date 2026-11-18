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

// A tool call Foundry holds until the user decides: every argument the agent proposed, as plain text, then Approve
// or Reject. The decision continues the same run as the thread's next turn; nothing runs before it.
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
  return (
    <div className="notice approval" role="group" aria-labelledby={`${id}-title`} aria-describedby={`${id}-effect`}>
      <p id={`${id}-title`}><strong>{copy.title}</strong></p>
      <dl className="approval-fields">
        {approvalFields(approval).map((field) => (
          <div key={field.name}>
            <dt>{field.label}</dt>
            <dd>{field.value}</dd>
          </div>
        ))}
      </dl>
      <p id={`${id}-effect`}>{copy.effect}</p>
      <div className="actions">
        <button type="button" className="primary" disabled={closed} onClick={() => decide(true)}>Approve</button>
        <button type="button" className="secondary" disabled={closed} onClick={() => decide(false)}>Reject</button>
      </div>
      {decided !== undefined && (
        <p ref={note} className="approval-note" tabIndex={-1}>{decided ? copy.approved : copy.rejected}</p>
      )}
    </div>
  )
}
