import { Link } from '@tanstack/react-router'
import { SiteHeader } from '../../../components/site-header'

export function HomePage() {
  return (
    <>
      <SiteHeader label="WebRTC connectivity diagnostics" showHomeLink={false} />

      <main className="home-page">
        <section className="intro home-intro">
          <span className="eyebrow">Native WebRTC diagnostics</span>
          <h1>Find whether two browsers can establish a direct peer connection</h1>
          <p>Compare local and STUN-assisted ICE paths, then inspect candidate types, connection state, data-channel RTT, and synthetic-video transport. The diagnostic uses native browser WebRTC APIs and does not require durable server state.</p>
        </section>

        <section className="diagnostic-card" aria-labelledby="manual-diagnostic-title">
          <div className="diagnostic-card-heading">
            <span className="diagnostic-index">01</span>
            <span className="label">Copy/paste workflow</span>
          </div>
          <h2 id="manual-diagnostic-title">Run a two-browser diagnostic</h2>
          <p>One browser creates a complete offer. The second browser processes it and returns a complete answer.</p>
          <ul>
            <li>Stateless deployment with no server coordination</li>
            <li>Non-trickle ICE embeds gathered candidates in each payload</li>
            <li>LAN-only and STUN-assisted configurations</li>
          </ul>
          <Link className="button primary diagnostic-action" to="/manual">Start diagnostic</Link>
        </section>

        <p className="home-guidance">You will need this page open in two browsers or devices, plus a way to transfer text between them.</p>
      </main>
    </>
  )
}
