import { Link } from '@tanstack/react-router'

export function SiteHeader({ label, showModeLink = true }: { label: string; showModeLink?: boolean }) {
  return (
    <header className="site-header">
      <Link className="brand" to="/">icecheck</Link>
      <div className="site-header-meta">
        <span>{label}</span>
        {showModeLink ? <Link to="/">choose mode</Link> : null}
        <a href="https://github.com/michidk/icecheck" target="_blank" rel="noreferrer">GitHub ↗</a>
      </div>
    </header>
  )
}
