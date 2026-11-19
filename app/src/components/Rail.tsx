import { PAGES, type PageId } from '../story.ts'

// The charcoal rail: the brand, one button per page and the reminder that everything is fictional.
export function Rail({ page, onNavigate }: { page: PageId; onNavigate: (page: PageId) => void }) {
  return (
    <header className="rail">
      <div className="brand">
        <span className="concept">Demo</span>
        <div>
          <p className="brand-title">Book Intelligence</p>
          <p className="brand-sub">Title performance &amp; publishing decisions</p>
        </div>
      </div>
      <nav aria-label="Pages">
        <ul className="nav">
          {PAGES.map((entry) => (
            <li key={entry.id}>
              <button type="button" aria-current={entry.id === page ? 'page' : undefined} onClick={() => onNavigate(entry.id)}>
                <span className="ni" aria-hidden="true">{entry.icon}</span>
                {entry.label}
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <div className="rail-bottom">
        <p className="rail-note"><b>Fictional demo</b>Synthetic data · live Foundry agents</p>
      </div>
    </header>
  )
}
