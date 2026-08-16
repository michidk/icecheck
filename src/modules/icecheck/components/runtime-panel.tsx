export function RuntimePanel({ signalingDisabled = false }: { signalingDisabled?: boolean }) {
  return (
    <section className="panel runtime-panel">
      <div className="section-header compact">
        <div>
          <h2>Runtime</h2>
          <p>Browser capabilities and endpoints used by this diagnostic session.</p>
        </div>
      </div>
      <dl className="runtime-table">
        <div><dt>secure_context</dt><dd><strong id="secure-context">checking</strong><small id="secure-detail" /></dd></div>
        <div>
          <dt>signaling_websocket</dt>
          <dd>
            <strong id="signal-status">{signalingDisabled ? 'disabled' : 'opening'}</strong>
            <small id="signal-detail">{signalingDisabled ? 'manual exchange; no WebSocket created' : 'SDP and ICE exchange only'}</small>
          </dd>
        </div>
        <div><dt>rtc_peer_connection</dt><dd><strong id="webrtc-status">checking</strong><small id="browser-detail" /></dd></div>
        <div><dt>stun_server</dt><dd><strong id="stun-status">loading</strong><small id="stun-detail" /></dd></div>
      </dl>
    </section>
  )
}
