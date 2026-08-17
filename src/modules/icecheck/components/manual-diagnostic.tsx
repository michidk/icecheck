import { SiteHeader } from '../../../components/site-header'
import { useManualDiagnostic } from '../hooks/use-manual-diagnostic'
import { ClientElements } from './client-elements'
import { RuntimePanel } from './runtime-panel'

export function ManualDiagnostic() {
  useManualDiagnostic()

  return (
    <>
      <SiteHeader label="ICE / STUN / WebRTC debugger" />

      <main className="diagnostic-page" data-icecheck-mode="manual">
        <section className="diagnostic-hero">
          <div>
            <span className="eyebrow">Direct browser-to-browser test</span>
            <h1>Debug a WebRTC connection</h1>
            <p>Open this page in both browsers. One creates an offer; the other returns an answer. The connection itself stays peer to peer.</p>
          </div>
          <div className="exchange-overview" aria-label="Offer and answer flow">
            <span>Browser A</span><i>offer →</i><span>Browser B</span><i>← answer</i><span>Browser A</span>
          </div>
        </section>

        <section id="manual-panel" className="panel exchange-workspace">
          <header className="workspace-header">
            <div>
              <span className="section-kicker">Configure</span>
              <h2>Start or answer a connection</h2>
            </div>
            <span className="protocol-badge"><i /> Complete ICE payloads</span>
          </header>

          <div className="manual-toolbar">
            <label htmlFor="manual-strategy">ICE path</label>
            <select id="manual-strategy" defaultValue="stun">
              <option value="lan">LAN only — no STUN</option>
              <option value="stun">STUN-assisted — direct candidates</option>
            </select>
            <button id="manual-create-offer" className="button primary" type="button" disabled>Create offer</button>
            <button id="manual-reset" className="button quiet" type="button">Start over</button>
          </div>

          <div className="role-guidance">
            <p><strong>Starting here?</strong> Select a path and create an offer.</p>
            <p><strong>Answering?</strong> Paste the other browser&apos;s offer; its path is selected automatically.</p>
          </div>

          <div className="exchange-heading">
            <span className="section-kicker">Exchange</span>
            <p>Move the outbound payload to the other browser, then bring its response back.</p>
          </div>

          <div className="manual-exchange">
            <section className="payload-panel outbound">
              <div className="payload-title">
                <span className="payload-direction">From this browser</span>
                <strong>Outbound payload</strong>
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
                <span className="payload-direction">From the other browser</span>
                <strong>Inbound payload</strong>
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
            <div>
              <span className="section-kicker">Inspect</span>
              <h2>Connection snapshot</h2>
            </div>
            <span className="live-indicator"><i /> Browser reported</span>
          </header>

          <dl className="manual-status">
            <div><dt>Role</dt><dd id="manual-role">idle</dd></div>
            <div><dt>ICE path</dt><dd id="manual-strategy-status">none</dd></div>
            <div><dt>Peer connection</dt><dd id="manual-connection">new</dd></div>
            <div><dt>ICE connection</dt><dd id="manual-ice">new</dd></div>
            <div><dt>ICE gathering</dt><dd id="manual-gathering">new</dd></div>
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

        <div className="diagnostic-footer-grid">
          <RuntimePanel />
          <aside className="security-panel">
            <span className="section-kicker">Payload safety</span>
            <h2>Keep connection data private</h2>
            <p>Base64url is encoding, not encryption. SDP can expose IP addresses, temporary ICE credentials, codecs, and browser or network metadata.</p>
          </aside>
        </div>
      </main>

      <ClientElements />
    </>
  )
}
