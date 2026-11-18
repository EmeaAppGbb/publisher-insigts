import { useEffect, useRef } from 'react'

// A native <dialog> shown as a modal while `open` holds: the browser traps focus, makes the page inert and closes it on
// Escape. Closing returns focus to the control that opened it or, once that control is gone, to the page's heading.
export function useModalDialog(open: boolean) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current
    if (!open || !dialog) return
    const active = document.activeElement
    const opener = active instanceof HTMLElement && active !== document.body ? active : undefined
    if (!dialog.open) dialog.showModal()
    return () => {
      if (dialog.open) dialog.close()
      const target = opener?.isConnected ? opener : document.querySelector<HTMLElement>('#main h1')
      target?.focus()
    }
  }, [open])
  return ref
}
