import { useEffect, useState } from 'react'

export interface ToastMessage {
  // A new ID shows the message again, even with the same text.
  id: number
  text: string
}

function Message({ text }: { text: string }) {
  const [visible, setVisible] = useState(true)
  useEffect(() => {
    const timer = setTimeout(() => setVisible(false), 3500)
    return () => clearTimeout(timer)
  }, [])
  return <p className={visible ? 'toast show' : 'toast'} aria-hidden={!visible}>{text}</p>
}

// A short note at the foot of the page, such as a story step's narrative. The region stays, so each new message is
// announced politely.
export function Toast({ toast }: { toast?: ToastMessage }) {
  return (
    <div className="toast-region" role="status">
      {toast && <Message key={toast.id} text={toast.text} />}
    </div>
  )
}
