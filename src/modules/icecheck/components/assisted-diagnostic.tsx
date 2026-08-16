import { SiteHeader } from '../../../components/site-header'
import { useIcecheckClient } from '../hooks/use-icecheck-client'
import { ClientElements } from './client-elements'
import { RuntimePanel } from './runtime-panel'

export function AssistedDiagnostic() {
  useIcecheckClient()

  return (
    <>
      <SiteHeader label="Assisted room diagnostic" />

      <main data-icecheck-mode="assisted">
        <section className="intro journey-intro">
          <span className="eyebrow">Server-assisted signaling</span>
          <h1>Trace a native WebRTC connection</h1>
          <p>Pair two browsers through the signaling WebSocket, then run fresh direct peer connections with no ICE server and with the configured STUN server. The probe data channel and video do not pass through the application server.</p>
          <ol className="journey-steps" aria-label="Assisted diagnostic steps">
            <li><span>1</span>Create room</li>
            <li><span>2</span>Open peer link</li>
            <li><span>3</span>Run probes</li>
          </ol>
        </section>

        <section id="setup-panel" className="panel setup-panel">
          <div className="section-header">
            <div>
              <h2>Create or join a room</h2>
              <p>The WebSocket carries coordination, SDP, and ICE candidates only. WebRTC carries the actual data and synthetic video.</p>
            </div>
            <span id="socket-badge" className="badge waiting"><i /><span>opening websocket</span></span>
          </div>
          <div className="setup-actions">
            <button id="create-room" className="button primary" type="button" disabled>Create room</button>
            <form id="join-form">
              <label htmlFor="room-input">Room code</label>
              <input id="room-input" maxLength={8} autoComplete="off" spellCheck={false} placeholder="ABC123" />
              <button className="button" type="submit" disabled>Join</button>
            </form>
          </div>
        </section>

        <section id="room-panel" className="panel room-panel" hidden>
          <div className="section-header">
            <div>
              <span id="role-label" className="label">host</span>
              <h2 id="room-state">Waiting for peer</h2>
              <p id="room-detail">Open the room URL on the second browser.</p>
            </div>
            <button id="room-code" className="room-code" type="button" title="Copy room code" />
          </div>
          <div id="share-row" className="share-row">
            <label htmlFor="share-link">Peer URL</label>
            <input id="share-link" readOnly />
            <button id="copy-link" className="button" type="button">Copy</button>
          </div>
        </section>

        <RuntimePanel />

        <section id="tests-section" className="tests-section" hidden>
          <div className="section-header tests-heading">
            <div>
              <h2>Probe matrix</h2>
              <p>Each row creates a new RTCPeerConnection, opens a bidirectional data channel, sends generated canvas video for seven seconds, and records getStats().</p>
            </div>
            <div id="host-controls" className="test-actions">
              <button id="run-all" className="button primary" type="button" disabled>Run all</button>
              <button id="copy-report" className="button" type="button">Copy JSON</button>
            </div>
          </div>

          <div className="strategy-header" aria-hidden="true">
            <span>ICE configuration</span><span>Candidate path</span><span>Transport result</span><span />
          </div>
          <div id="strategy-list" className="strategy-list" />

          <section id="diagnosis" className="diagnosis" hidden>
            <span>diagnosis</span>
            <strong id="diagnosis-title" />
            <p id="diagnosis-detail" />
          </section>

          <div className="diagnostic-output">
            <details className="event-log" open>
              <summary>Event log <span id="event-count">0 events</span></summary>
              <ol id="events" />
            </details>
            <details className="raw-report">
              <summary>Session JSON</summary>
              <pre id="raw-report">No probe results yet.</pre>
            </details>
          </div>
        </section>
      </main>

      <ClientElements />
    </>
  )
}
