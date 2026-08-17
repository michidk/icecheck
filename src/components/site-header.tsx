import { Link } from '@tanstack/react-router'

export function SiteHeader({ label, showHomeLink = true }: { label: string; showHomeLink?: boolean }) {
  return (
    <header className="site-header">
      <Link className="brand" to="/">icecheck</Link>
      <div className="site-header-meta">
        <span>{label}</span>
        {showHomeLink ? <Link to="/">Overview</Link> : null}
        <a href="https://github.com/michidk/icecheck" target="_blank" rel="noreferrer">GitHub <span aria-hidden="true">↗</span></a>
      </div>
    </header>
  )
}
