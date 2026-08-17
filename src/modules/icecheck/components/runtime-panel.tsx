export function RuntimePanel() {
  return (
    <section className="runtime-panel">
      <header>
        <span className="section-kicker">Environment</span>
        <h2>Browser readiness</h2>
      </header>
      <dl className="runtime-table">
        <div><dt>Secure context</dt><dd><strong id="secure-context">checking</strong><small id="secure-detail" /></dd></div>
        <div><dt>WebRTC API</dt><dd><strong id="webrtc-status">checking</strong><small id="browser-detail" /></dd></div>
        <div><dt>Configured STUN servers</dt><dd><strong id="stun-status">loading</strong><small id="stun-detail" /></dd></div>
      </dl>
    </section>
  )
}
