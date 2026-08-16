import { Link } from '@tanstack/react-router'
import { useEffect } from 'react'
import { SiteHeader } from '../../../components/site-header'

export function HomePage() {
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('manual') === '1') {
      window.location.replace(`${import.meta.env.BASE_URL}manual`)
    }
  }, [])

  return (
    <>
      <SiteHeader label="WebRTC connectivity diagnostics" showModeLink={false} />

      <main className="mode-home">
        <section className="intro mode-intro">
          <span className="eyebrow">Native WebRTC diagnostics</span>
          <h1>Find where a peer connection fails</h1>
          <p>Connect two browsers, compare direct ICE paths with and without STUN, and inspect the selected candidate pair, state transitions, data-channel RTT, and synthetic-video stats. This is a connectivity diagnostic—not a bandwidth benchmark—and it does not use PeerJS or TURN.</p>
        </section>

        <section className="mode-grid" aria-label="Diagnostic modes">
          <article className="mode-card recommended">
            <div className="mode-card-heading">
              <span className="mode-index">01</span>
              <span className="label">Recommended</span>
            </div>
            <h2>Server-assisted signaling</h2>
            <p>A WebSocket exchanges SDP and trickled ICE candidates, then each probe runs over native WebRTC.</p>
            <ul>
              <li>Checks the WebSocket signaling path</li>
              <li>Compares no-server and STUN configurations</li>
              <li>Verifies data-channel and video transport</li>
            </ul>
            <Link className="button primary mode-action" to="/session">Start assisted test</Link>
          </article>

          <article className="mode-card">
            <div className="mode-card-heading">
              <span className="mode-index">02</span>
              <span className="label">Developer mode</span>
            </div>
            <h2>Manual SDP exchange</h2>
            <p>Carry complete base64url offers and answers yourself to remove the signaling server from the test.</p>
            <ul>
              <li>Never opens the signaling WebSocket</li>
              <li>Uses non-trickle ICE with embedded candidates</li>
              <li>Tests one ICE configuration per exchange</li>
            </ul>
            <Link className="button mode-action" to="/manual">Open manual mode</Link>
          </article>
        </section>

        <p className="mode-guidance"><strong>Choose assisted</strong> for the complete deployed path. Choose manual when you suspect WebSocket handling, a reverse proxy, or the signaling protocol.</p>
      </main>
    </>
  )
}
