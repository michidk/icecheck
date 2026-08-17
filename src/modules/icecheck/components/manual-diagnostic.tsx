import { SiteHeader } from '../../../components/site-header'
import { useManualDiagnostic } from '../hooks/use-manual-diagnostic'
import { ClientElements } from './client-elements'
import { RuntimePanel } from './runtime-panel'

export function ManualDiagnostic() {
  useManualDiagnostic()

  return (
    <>
      <SiteHeader label="Manual signaling diagnostic" />

      <main data-icecheck-mode="manual">
        <section className="intro journey-intro">
          <span className="eyebrow">Two-browser WebRTC diagnostic</span>
          <h1>Exchange an offer and answer by hand</h1>
          <p>Open this page in two browsers and carry the generated base64url payloads between them. The application server only supplies public STUN configuration; the browsers negotiate the WebRTC path directly.</p>
          <ol className="journey-steps" aria-label="Manual diagnostic steps">
            <li><span>1</span>Browser A creates an offer</li>
            <li><span>2</span>Browser B returns an answer</li>
            <li><span>3</span>Both inspect the path</li>
          </ol>
        </section>

        <section id="manual-panel" className="panel manual-panel">
          <div className="section-header manual-heading">
            <div>
              <h2>Copy and paste the connection payloads</h2>
              <p>Create an offer on one browser. Paste and process it on the other, then copy the generated answer back.</p>
            </div>
            <div className="manual-heading-actions">
              <span className="badge"><i /><span>non-trickle ICE</span></span>
            </div>
          </div>

          <div className="manual-toolbar">
            <label htmlFor="manual-strategy">ice_configuration</label>
            <select id="manual-strategy" defaultValue="stun">
              <option value="lan">LAN only</option>
              <option value="stun">STUN only</option>
            </select>
            <button id="manual-create-offer" className="button primary" type="button" disabled>Create offer</button>
            <button id="manual-reset" className="button" type="button">Reset</button>
          </div>

          <div className="manual-exchange">
            <section>
              <div className="field-heading">
                <label htmlFor="manual-local-payload">local_payload</label>
                <span id="manual-local-meta">Create or accept an offer first.</span>
              </div>
              <textarea id="manual-local-payload" readOnly spellCheck={false} placeholder="A base64url offer or answer will appear here." />
              <button id="manual-copy-payload" className="button" type="button" disabled>Copy local payload</button>
            </section>
            <section>
              <div className="field-heading">
                <label htmlFor="manual-remote-payload">remote_payload</label>
                <span>Paste the other browser&apos;s payload.</span>
              </div>
              <textarea id="manual-remote-payload" spellCheck={false} placeholder="Paste base64url here." />
              <button id="manual-process-payload" className="button" type="button" disabled>Process remote payload</button>
            </section>
          </div>

          <dl className="manual-status">
            <div><dt>role</dt><dd id="manual-role">idle</dd></div>
            <div><dt>strategy</dt><dd id="manual-strategy-status">none</dd></div>
            <div><dt>connection</dt><dd id="manual-connection">new</dd></div>
            <div><dt>ice</dt><dd id="manual-ice">new</dd></div>
            <div><dt>gathering</dt><dd id="manual-gathering">new</dd></div>
            <div><dt>data_channel</dt><dd id="manual-data">closed</dd></div>
            <div><dt>video</dt><dd id="manual-video">not negotiated</dd></div>
            <div><dt>local_candidates</dt><dd id="manual-local-candidates">none</dd></div>
            <div><dt>remote_candidates</dt><dd id="manual-remote-candidates">none</dd></div>
            <div className="wide"><dt>selected_pair</dt><dd id="manual-selected-pair">none</dd></div>
          </dl>

          <details className="manual-result" open>
            <summary>Manual probe JSON <button id="manual-copy-report" className="text-button" type="button">copy</button></summary>
            <pre id="manual-report">No manual connection is active.</pre>
          </details>
          <p className="manual-warning"><strong>Security:</strong> base64url is not encryption. SDP can contain IP addresses, ICE credentials, codecs, and browser/network metadata. Share payloads only with the intended peer.</p>
        </section>

        <RuntimePanel />
      </main>

      <ClientElements />
    </>
  )
}
