import { SiteHeader } from '../../../components/site-header'
import { useManualDiagnostic } from '../hooks/use-manual-diagnostic'
import { ClientElements } from './client-elements'
import { RuntimePanel } from './runtime-panel'

export function ManualDiagnostic() {
  useManualDiagnostic()

  return (
    <>
      <SiteHeader />

      <main className="diagnostic-page" data-icecheck-mode="manual">
        <section className="diagnostic-hero">
          <div className="hero-copy">
            <h1>Test the real WebRTC path between two browsers.</h1>
            <p>icecheck establishes a direct browser-to-browser connection, then shows the ICE candidates, selected network path, data-channel latency, and video transport that actually work.</p>
          </div>
          <ol className="quick-guide" aria-label="How the diagnostic works">
            <li><span>01</span><div><strong>Open twice</strong><small>Load this page in both browsers.</small></div></li>
            <li><span>02</span><div><strong>Exchange payloads</strong><small>Send the offer over, then the answer back.</small></div></li>
            <li><span>03</span><div><strong>Read the path</strong><small>Compare live results on both sides.</small></div></li>
          </ol>
        </section>

        <aside className="privacy-banner">
          <span className="privacy-icon" aria-hidden="true">⌁</span>
          <p><strong>Your connection data stays with you.</strong> Payloads travel only through your clipboard and the private channel you choose.</p>
          <span>Base64url ≠ encryption</span>
        </aside>

        <section id="manual-panel" className="panel exchange-workspace">
          <header className="workspace-header">
            <div className="title-with-step">
              <span className="step-number">01</span>
              <div>
                <h2>Start or answer a connection</h2>
              </div>
            </div>
          </header>

          <div className="manual-toolbar">
            <label htmlFor="manual-strategy">Connection strategy</label>
            <select id="manual-strategy" defaultValue="stun">
              <option value="lan">LAN only — no STUN</option>
              <option value="stun">STUN-assisted — direct candidates</option>
            </select>
            <button id="manual-create-offer" className="button primary" type="button" disabled>Create an offer <span aria-hidden="true">→</span></button>
            <button id="manual-reset" className="button quiet" type="button">Start over</button>
          </div>

          <div className="role-guidance">
            <p><strong>Starting here?</strong> Select a path and create an offer.</p>
            <p><strong>Answering?</strong> Paste the other browser&apos;s offer; its path is selected automatically.</p>
          </div>

          <div className="exchange-heading">
              <p><strong>Clipboard handoff.</strong> Send the outbound payload privately, then paste the response you receive.</p>
          </div>

          <div className="manual-exchange">
            <section className="payload-panel outbound">
              <div className="payload-title">
                <span className="payload-direction"><i /> From this browser</span>
                <strong>Send</strong>
              </div>
              <div className="field-heading">
                <label htmlFor="manual-local-payload">Offer or answer to send</label>
                <span id="manual-local-meta">Nothing generated yet</span>
              </div>
              <textarea id="manual-local-payload" aria-describedby="manual-local-meta" readOnly spellCheck={false} placeholder="Your generated payload will appear here." />
              <button id="manual-copy-payload" className="button payload-action" type="button" disabled>Copy outbound payload</button>
            </section>

            <div className="exchange-divider" aria-hidden="true"><span>⇄</span></div>

            <section className="payload-panel inbound">
              <div className="payload-title">
                <span className="payload-direction"><i /> From the other browser</span>
                <strong>Receive</strong>
              </div>
              <div className="field-heading">
                <label htmlFor="manual-remote-payload">Offer or answer to apply</label>
                <span id="manual-remote-help">Paste below</span>
              </div>
              <textarea id="manual-remote-payload" aria-describedby="manual-remote-help" spellCheck={false} autoCapitalize="none" autoCorrect="off" placeholder="Paste the other browser's payload here." />
              <button id="manual-process-payload" className="button primary payload-action" type="button" disabled>Apply inbound payload</button>
            </section>
          </div>
        </section>

        <section className="panel results-panel">
          <header className="workspace-header results-header">
            <div className="title-with-step">
              <span className="step-number">02</span>
              <div>
                <h2>Connection snapshot</h2>
              </div>
            </div>
          </header>

          <dl className="manual-status">
            <div><dt>Role</dt><dd id="manual-role">idle</dd></div>
            <div><dt>ICE path</dt><dd id="manual-strategy-status">none</dd></div>
            <div><dt>Peer connection</dt><dd id="manual-connection">new</dd></div>
            <div><dt>ICE connection</dt><dd id="manual-ice">new</dd></div>
            <div><dt>ICE gathering</dt><dd id="manual-gathering">new</dd></div>
            <div><dt>STUN discovery</dt><dd id="manual-stun-result" className="stun-value">not started</dd></div>
            <div><dt>STUN server</dt><dd id="manual-stun-server" className="stun-value">none</dd></div>
            <div><dt>Selected path</dt><dd id="manual-stun-path" className="stun-value">waiting</dd></div>
            <div><dt>Data channel</dt><dd id="manual-data">closed</dd></div>
            <div><dt>Video track</dt><dd id="manual-video">not negotiated</dd></div>
            <div><dt>Local candidates</dt><dd id="manual-local-candidates">none</dd></div>
            <div><dt>Remote candidates</dt><dd id="manual-remote-candidates">none</dd></div>
            <div className="selected-pair"><dt>Selected candidate pair</dt><dd id="manual-selected-pair">none</dd></div>
          </dl>

          <div className="report-row">
            <details className="manual-result">
              <summary>View raw diagnostic JSON</summary>
              <pre id="manual-report">No manual connection is active.</pre>
            </details>
            <button id="manual-copy-report" className="button quiet" type="button">Copy report</button>
          </div>
        </section>

        <RuntimePanel />
      </main>

      <ClientElements />
    </>
  )
}
