import type { Session } from '../live/types.ts'

interface TopbarProps {
  crumb: string
  session?: Session
  onSignIn: () => void
  onSignOut: () => void
  onTrust: () => void
  onDemo: () => void
}

// The page's crumb, then mock mode's label, the account, and the drawer and demo control.
export function Topbar({ crumb, session, onSignIn, onSignOut, onTrust, onDemo }: TopbarProps) {
  return (
    <div className="topbar">
      <p className="crumb">{crumb}</p>
      <div className="top-actions">
        {session?.notice && <span className="tag orange mock-tag">{session.notice}</span>}
        {session?.mode === 'live' && (session.identity ? (
          <>
            <span className="user">{session.identity.name}</span>
            <button type="button" className="icon-btn" onClick={onSignOut}>Sign out</button>
          </>
        ) : (
          <button type="button" className="btn primary small-btn" onClick={onSignIn}>Sign in</button>
        ))}
        <button type="button" className="icon-btn" aria-haspopup="dialog" title="How I got this" onClick={onTrust}>
          <span aria-hidden="true">ⓘ</span> Trust
        </button>
        <button type="button" className="icon-btn" aria-haspopup="dialog" onClick={onDemo}>
          <span aria-hidden="true">☰</span> Demo control
        </button>
      </div>
    </div>
  )
}
