import { Link } from '@tanstack/react-router'

export function SiteHeader() {
  return (
    <header className="site-header">
      <Link className="brand" to="/">icecheck</Link>
      <div className="site-header-meta">
        <span>WebRTC connectivity diagnostics</span>
        <a href="https://github.com/michidk/icecheck" target="_blank" rel="noreferrer">GitHub ↗</a>
      </div>
    </header>
  )
}
