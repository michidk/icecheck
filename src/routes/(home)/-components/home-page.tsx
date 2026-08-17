import { Link } from '@tanstack/react-router'
import { SiteHeader } from '../../../components/site-header'

export function HomePage() {
  return (
    <>
      <SiteHeader label="ICE / STUN / WebRTC debugger" showHomeLink={false} />

      <main className="home-page">
        <section className="home-hero">
          <div className="home-copy">
            <span className="eyebrow">Peer-to-peer network diagnostics</span>
            <h1>Debug ICE, STUN &amp; WebRTC</h1>
            <p>See how two browsers discover each other, which candidate pair wins, and whether data and video make it across the negotiated path.</p>
            <div className="home-actions">
              <Link className="button primary home-primary-action" to="/manual">Open diagnostic</Link>
              <a className="button quiet" href="#what-you-see">What you&apos;ll see</a>
            </div>
            <p className="home-requirement"><span aria-hidden="true">●</span> Two browsers, two minutes, no account</p>
          </div>

          <div className="path-visual" role="img" aria-label="A WebRTC path from Browser A through ICE candidate selection to Browser B">
            <div className="path-visual-header">
              <span>Connection path</span>
              <strong>Peer to peer</strong>
            </div>
            <div className="path-diagram">
              <div className="peer-node">
                <span>A</span>
                <strong>Browser A</strong>
                <small>offer</small>
              </div>
              <div className="path-link">
                <i />
                <span>ICE checks</span>
              </div>
              <div className="ice-node">
                <strong>Selected pair</strong>
                <span>host · srflx · prflx</span>
              </div>
              <div className="path-link reverse">
                <i />
                <span>DTLS + SRTP</span>
              </div>
              <div className="peer-node">
                <span>B</span>
                <strong>Browser B</strong>
                <small>answer</small>
              </div>
            </div>
            <div className="path-legend">
              <span><i className="legend-dot lan" /> LAN</span>
              <span><i className="legend-dot stun" /> STUN-assisted</span>
              <span><i className="legend-dot direct" /> Direct transport</span>
            </div>
          </div>
        </section>

        <section id="what-you-see" className="capability-section" aria-labelledby="capability-heading">
          <div className="capability-intro">
            <span className="eyebrow">Inside the connection</span>
            <h2 id="capability-heading">See what the browser actually negotiated</h2>
          </div>
          <div className="capability-grid">
            <article><span>ICE</span><h3>Candidate discovery</h3><p>Compare host, server-reflexive, and peer-reflexive candidate counts.</p></article>
            <article><span>PATH</span><h3>Selected pair</h3><p>Inspect the local and remote endpoints that carry the live connection.</p></article>
            <article><span>DATA</span><h3>Channel latency</h3><p>Confirm SCTP connectivity with application-level round-trip samples.</p></article>
            <article><span>MEDIA</span><h3>Video transport</h3><p>Verify generated video using negotiated tracks and RTP byte counters.</p></article>
          </div>
        </section>

        <aside className="privacy-note">
          <strong>Private by design.</strong>
          <span>The offer and answer move through your clipboard, never through icecheck. Payloads can contain network metadata, so transfer them over a private channel.</span>
        </aside>
      </main>
    </>
  )
}
