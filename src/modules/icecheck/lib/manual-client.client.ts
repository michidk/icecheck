import {
  MANUAL_PROTOCOL_VERSION,
  decodeSignalEnvelope,
  encodeSignalEnvelope,
  type ManualDescriptionKind,
  type ManualSignalEnvelope,
} from './manual-codec.ts'
import { countCandidatesInSdp } from './diagnostic-report.ts'
import type {
  CandidateCounts,
  CandidatePair,
  CandidateSummary,
  IceConfiguration,
  Probe,
  ProbeResult,
  Strategy,
} from './diagnostic-types.ts'
import { collectProbeResult } from './probe-result.client.ts'
import { createProbeSession, type ProbeSession } from './probe-session.client.ts'

export interface ManualDiagnosticController {
  dispose(): void
}

type AppElement = HTMLElement & {
  disabled: boolean
  value: string
}

const MANUAL_GATHER_TIMEOUT_MS = 15_000

const $ = <ElementType extends Element = AppElement>(selector: string): ElementType => {
  const element = document.querySelector<ElementType>(selector)
  if (!element) throw new Error(`Missing required element: ${selector}`)
  return element
}

let activeController: ManualDiagnosticController | undefined

export function mountManualDiagnostic(): ManualDiagnosticController {
  activeController?.dispose()
  let disposed = false
  let configuration: IceConfiguration = { stunServers: [] }
  let configurationState: 'loading' | 'ready' | 'failed' = 'loading'
  let configurationError: string | undefined
  let probe: ProbeSession | undefined
  let monitor: ReturnType<typeof setInterval> | undefined
  let busy = false
  let toastTimer: ReturnType<typeof setTimeout> | undefined
  const abort = new AbortController()
  const cleanups: (() => void)[] = []

  const strategies: Strategy[] = [
    {
      id: 'lan',
      name: 'LAN only',
      path: 'host / prflx',
      config: () => ({ iceServers: [], iceTransportPolicy: 'all' }),
    },
    {
      id: 'stun',
      name: 'STUN-assisted',
      path: 'host / srflx / prflx',
      config: () => ({ iceServers: configuration.stunServers, iceTransportPolicy: 'all' }),
    },
  ]

  const controller: ManualDiagnosticController = {
    dispose() {
      if (disposed || activeController !== controller) return
      disposed = true
      abort.abort()
      for (const cleanup of cleanups.splice(0)) cleanup()
      clearTimeout(toastTimer)
      cleanupProbe()
      activeController = undefined
    },
  }
  activeController = controller
  bindControls()
  setReadyWorkflow()
  renderEnvironment()
  void initialize()
  return controller

  async function initialize() {
    try {
      const response = await fetch('/config', { cache: 'no-store', signal: abort.signal })
      if (!response.ok) throw new Error(`ICE configuration request failed with HTTP ${response.status}.`)
      configuration = parseIceConfiguration(await response.json())
      configurationState = 'ready'
    } catch (error: unknown) {
      if (disposed || isAbortError(error)) return
      configurationState = 'failed'
      configurationError = errorMessage(error, 'ICE configuration could not be loaded.')
      showFailure(error)
    } finally {
      if (!disposed) {
        const stunAvailable = hasStunConfiguration()
        $<HTMLOptionElement>('#manual-stun-option').disabled = !stunAvailable
        if (!stunAvailable) $('#manual-strategy').value = 'lan'
        renderEnvironment()
        if (!probe && !configurationError) setReadyWorkflow()
        syncControls()
      }
    }
  }

  function renderEnvironment() {
    $('#secure-context').textContent = window.isSecureContext ? 'true' : 'false'
    $('#secure-context').style.color = window.isSecureContext ? 'var(--good)' : 'var(--warn)'
    $('#secure-detail').textContent = location.protocol === 'https:' ? 'HTTPS' : `${location.protocol} (diagnostics still work)`

    const supported = typeof RTCPeerConnection !== 'undefined'
    $('#webrtc-status').textContent = supported ? 'available' : 'unavailable'
    $('#webrtc-status').style.color = supported ? 'var(--good)' : 'var(--bad)'
    $('#browser-detail').textContent = `${browserName()} · ${navigator.platform || 'unknown platform'}`

    const stunUrls = configuredStunUrls()
    const status = $('#stun-status')
    if (configurationState === 'loading') {
      status.textContent = 'loading'
      status.style.color = 'var(--warn)'
      $('#stun-detail').textContent = 'fetching /config'
    } else if (configurationState === 'failed') {
      status.textContent = 'unavailable'
      status.style.color = 'var(--bad)'
      $('#stun-detail').textContent = 'LAN-only remains available'
    } else if (!stunUrls.length) {
      status.textContent = 'not configured'
      status.style.color = 'var(--warn)'
      $('#stun-detail').textContent = 'LAN-only remains available'
    } else {
      status.textContent = `${stunUrls.length} endpoint${stunUrls.length === 1 ? '' : 's'}`
      status.style.color = 'var(--good)'
      $('#stun-detail').textContent = stunUrls.join(', ')
    }

    const shareButton = $<HTMLButtonElement>('#manual-share-payload')
    shareButton.hidden = typeof navigator.share !== 'function'
    shareButton.parentElement?.classList.toggle('share-available', !shareButton.hidden)
  }

  async function createOffer() {
    if (busy || configurationState === 'loading') return
    clearFailure()
    setBusy(true, 'Gathering offer ICE…')
    setWorkflow('Gathering', 'Creating an offer', 'Waiting for this browser to finish ICE candidate discovery.')
    cleanupProbe()
    $('#manual-remote-payload').value = ''
    try {
      const strategy = getSelectedStrategy()
      const session = createProbe(strategy, makeId(), true)
      probe = session
      startMonitor(session)
      const offer = await session.pc.createOffer()
      await session.pc.setLocalDescription(offer)
      const iceComplete = await session.waitForGathering(MANUAL_GATHER_TIMEOUT_MS)
      if (disposed || probe !== session) return
      setLocalPayload(makeEnvelope('offer', session, iceComplete))
    } catch (error: unknown) {
      showFailure(error)
    } finally {
      setBusy(false)
      updateStatus(probe)
    }
  }

  async function processPayload() {
    if (busy || configurationState === 'loading') return
    clearFailure()
    setBusy(true, 'Processing payload…')
    setWorkflow('Validating', 'Checking the inbound payload', 'Confirming its session, role, and connection strategy before applying it.')
    try {
      const envelope = decodeSignalEnvelope($('#manual-remote-payload').value)
      if (envelope.kind === 'offer') await acceptOffer(envelope)
      else await applyAnswer(envelope)
    } catch (error: unknown) {
      showFailure(error)
    } finally {
      setBusy(false)
      updateStatus(probe)
    }
  }

  async function acceptOffer(envelope: ManualSignalEnvelope) {
    const strategy = strategies.find(({ id }) => id === envelope.strategyId)
    if (!strategy) throw new Error('The offer uses an unsupported ICE strategy.')
    if (strategy.id === 'stun' && !hasStunConfiguration()) {
      throw new Error('This offer requires STUN-assisted mode, but no STUN configuration is available in this browser.')
    }
    cleanupProbe()
    $('#manual-strategy').value = strategy.id
    setWorkflow('Answering', 'Creating the answer', 'The offer is valid. Waiting for this browser to finish ICE candidate discovery.')
    const session = createProbe(strategy, envelope.sessionId, false)
    probe = session
    session.remoteCandidates = countCandidatesInSdp(envelope.description.sdp)
    startMonitor(session)
    await session.pc.setRemoteDescription(envelope.description)
    const answer = await session.pc.createAnswer()
    await session.pc.setLocalDescription(answer)
    const iceComplete = await session.waitForGathering(MANUAL_GATHER_TIMEOUT_MS)
    if (disposed || probe !== session) return
    setLocalPayload(makeEnvelope('answer', session, iceComplete))
  }

  async function applyAnswer(envelope: ManualSignalEnvelope) {
    if (!probe?.initiator) throw new Error('Create an offer on this browser before applying an answer.')
    if (envelope.sessionId !== probe.testId) throw new Error('This answer belongs to a different manual session.')
    if (envelope.strategyId !== probe.strategy.id) throw new Error('The answer uses a different ICE strategy.')
    if (probe.pc.remoteDescription) throw new Error('An answer has already been applied to this session.')
    probe.remoteCandidates = countCandidatesInSdp(envelope.description.sdp)
    await probe.pc.setRemoteDescription(envelope.description)
    $('#manual-local-meta').textContent = `offer · answer applied · ${$('#manual-local-payload').value.length} chars`
    setWorkflow('Connecting', 'Answer applied', 'The browsers are negotiating a direct path. Keep both pages open while the checks finish.')
    await refreshReport(probe)
  }

  function createProbe(strategy: Strategy, testId: string, initiator: boolean): ProbeSession {
    return createProbeSession({
      delay,
      initiator,
      onUpdate: updateStatus,
      strategy,
      testId,
      video: $<HTMLVideoElement>('#probe-video'),
    })
  }

  function makeEnvelope(kind: ManualDescriptionKind, session: Probe, iceComplete: boolean): ManualSignalEnvelope {
    const description = session.pc.localDescription
    if (!description?.sdp || (description.type !== 'offer' && description.type !== 'answer')) {
      throw new Error('The browser did not create a complete local session description.')
    }
    return {
      version: MANUAL_PROTOCOL_VERSION,
      kind,
      sessionId: session.testId,
      strategyId: session.strategy.id,
      createdAt: new Date().toISOString(),
      iceComplete,
      description: { type: description.type, sdp: description.sdp },
    }
  }

  function setLocalPayload(envelope: ManualSignalEnvelope) {
    const encoded = encodeSignalEnvelope(envelope)
    $('#manual-local-payload').value = encoded
    $('#manual-local-meta').textContent = `${envelope.kind} · ${encoded.length} chars · ICE ${envelope.iceComplete ? 'complete' : 'timed out'}`
    if (envelope.kind === 'offer') {
      setWorkflow('Offer ready', 'Send this offer to the other browser', 'Copy or share it, then paste the answer you receive into the inbound field.')
    } else {
      setWorkflow('Answer ready', 'Send this answer back', 'Copy or share it with the offerer. This browser will connect after the offerer applies it.')
    }
    syncControls()
  }

  function startMonitor(session: ProbeSession) {
    clearInterval(monitor)
    updateStatus(session)
    void refreshReport(session)
    monitor = setInterval(() => { void refreshReport(session) }, 1_000)
  }

  async function refreshReport(session: ProbeSession) {
    if (disposed || session !== probe || session.pc.connectionState === 'closed') return
    const result = await collectProbeResult(session)
    if (disposed || session !== probe) return
    recordReportedStunUrls(session, result.selectedPair)
    const manualResult = {
      mode: 'manual-non-trickle',
      protocolVersion: MANUAL_PROTOCOL_VERSION,
      sessionId: session.testId,
      strategyId: session.strategy.id,
      role: session.initiator ? 'offerer' : 'answerer',
      sampledAt: new Date().toISOString(),
      stun: summarizeStun(session, result.selectedPair),
      result,
    }
    $('#manual-report').textContent = JSON.stringify(manualResult, null, 2)
    $('#manual-selected-pair').textContent = result.selectedPair ? formatDetailedPair(result.selectedPair) : 'none'
    renderSelectedStunPath(result.selectedPair, result.connectionState)
    updateStatus(session)
    renderVerdict(result)
  }

  function updateStatus(session: Probe | undefined) {
    if (!session || session !== probe || disposed) return
    $('#manual-role').textContent = session.initiator ? 'offerer' : 'answerer'
    $('#manual-strategy-status').textContent = `${session.strategy.name} (${session.strategy.path})`
    $('#manual-connection').textContent = session.pc.connectionState
    $('#manual-ice').textContent = session.pc.iceConnectionState
    $('#manual-gathering').textContent = session.pc.iceGatheringState
    renderStunDiscovery(session)
    $('#manual-data').textContent = session.channel?.readyState || 'not created'
    $('#manual-video').textContent = session.videoReceived ? 'bytes received' : session.videoNegotiated ? 'negotiated' : session.mediaSupported ? 'sending synthetic track' : 'not negotiated'
    $('#manual-local-candidates').textContent = formatCandidateCounts(session.localCandidates)
    $('#manual-remote-candidates').textContent = formatCandidateCounts(session.remoteCandidates)
    if (session.pc.connectionState === 'failed' || session.pc.iceConnectionState === 'failed') {
      setVerdict('Failed', 'No direct path established', 'The exchanged candidates did not produce a working direct connection.', 'failure')
      setWorkflow('Stopped', 'The direct connection failed', 'Review the candidate details and errors below, then start over to try another strategy.')
    } else if (session.pc.connectionState === 'connected') {
      setVerdict('Connected', 'Direct transport connected', 'Data-channel and video checks are still settling.', 'pending')
    } else {
      setVerdict('Checking', 'Negotiation in progress', `Peer connection: ${session.pc.connectionState}; ICE: ${session.pc.iceConnectionState}.`, 'pending')
    }
  }

  function reset() {
    cleanupProbe()
    $('#manual-local-payload').value = ''
    $('#manual-remote-payload').value = ''
    $('#manual-local-meta').textContent = 'Nothing generated yet'
    $('#manual-role').textContent = 'idle'
    $('#manual-strategy-status').textContent = 'none'
    $('#manual-connection').textContent = 'new'
    $('#manual-ice').textContent = 'new'
    $('#manual-gathering').textContent = 'new'
    setStunValue('#manual-stun-result', 'not started')
    setStunValue('#manual-stun-server', 'none')
    setStunValue('#manual-stun-path', 'waiting')
    $('#manual-data').textContent = 'closed'
    $('#manual-video').textContent = 'not negotiated'
    $('#manual-local-candidates').textContent = 'none'
    $('#manual-remote-candidates').textContent = 'none'
    $('#manual-selected-pair').textContent = 'none'
    $('#manual-report').textContent = 'No manual connection is active.'
    setVerdict('Not started', 'No connection tested yet', 'Complete the clipboard exchange to test a direct path.', 'idle')
    if (configurationError) showPersistentError(configurationError)
    else clearFailure()
    setReadyWorkflow()
    syncControls()
  }

  function cleanupProbe() {
    clearInterval(monitor)
    monitor = undefined
    probe?.destroy()
    probe = undefined
  }

  function setBusy(nextBusy: boolean, label = '') {
    busy = nextBusy
    if (disposed) return
    $('#manual-panel').setAttribute('aria-busy', String(busy))
    $('#manual-create-offer').textContent = busy && label.includes('offer') ? 'Gathering ICE…' : 'Create offer'
    $('#manual-process-payload').textContent = busy && !label.includes('offer') ? 'Applying…' : 'Apply inbound payload'
    if (label) $('#manual-report').textContent = label
    syncControls()
  }

  function syncControls() {
    if (disposed) return
    const configurationSettled = configurationState !== 'loading'
    const selectedStun = $('#manual-strategy').value === 'stun'
    const supported = typeof RTCPeerConnection !== 'undefined'
    $('#manual-create-offer').disabled = busy || !configurationSettled || !supported || (selectedStun && !hasStunConfiguration())
    $('#manual-process-payload').disabled = busy || !configurationSettled || !supported || !$('#manual-remote-payload').value.trim()
    $('#manual-copy-payload').disabled = !$('#manual-local-payload').value
    $('#manual-share-payload').disabled = !$('#manual-local-payload').value
    $('#manual-reset').disabled = busy
    $('#manual-strategy').disabled = busy
    $('#manual-remote-payload').disabled = busy
  }

  function showFailure(error: unknown) {
    if (disposed) return
    const message = errorMessage(error, 'Manual signaling failed.')
    $('#manual-report').textContent = JSON.stringify({ error: message, at: new Date().toISOString() }, null, 2)
    showPersistentError(message)
    setWorkflow('Action needed', 'The last action could not be completed', 'Review the error, correct the payload or strategy, and try again.')
  }

  function showPersistentError(message: string) {
    const error = $<HTMLElement>('#manual-error')
    $('#manual-error-message').textContent = message
    error.hidden = false
  }

  function clearFailure() {
    const error = $<HTMLElement>('#manual-error')
    $('#manual-error-message').textContent = ''
    error.hidden = true
  }

  function showToast(message: string) {
    if (disposed) return
    const toast = $('#toast')
    toast.textContent = message
    toast.classList.add('show')
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => toast.classList.remove('show'), 2_800)
  }

  function bindControls() {
    listen($('#manual-create-offer'), 'click', () => { void createOffer() })
    listen($('#manual-process-payload'), 'click', () => { void processPayload() })
    listen($('#manual-reset'), 'click', reset)
    listen($('#manual-strategy'), 'change', () => {
      clearFailure()
      setReadyWorkflow()
      syncControls()
    })
    listen($('#manual-remote-payload'), 'input', syncControls)
    listen($('#manual-copy-payload'), 'click', () => {
      void copyText($('#manual-local-payload').value, 'Outbound payload copied.')
    })
    listen($('#manual-share-payload'), 'click', () => { void sharePayload() })
    listen($('#manual-copy-report'), 'click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      void copyText($('#manual-report').textContent || '', 'Manual probe report copied.')
    })
  }

  function listen(target: EventTarget, type: string, listener: EventListener) {
    target.addEventListener(type, listener)
    cleanups.push(() => target.removeEventListener(type, listener))
  }

  async function copyText(text: string, confirmation: string) {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      const area = document.createElement('textarea')
      area.value = text
      document.body.append(area)
      area.select()
      document.execCommand('copy')
      area.remove()
    }
    if (disposed) return
    showToast(confirmation)
  }

  async function sharePayload() {
    const text = $('#manual-local-payload').value
    if (!text || typeof navigator.share !== 'function') return
    const kind = probe?.initiator ? 'offer' : 'answer'
    const shareData = { title: `icecheck ${kind}`, text }
    if (typeof navigator.canShare === 'function' && !navigator.canShare(shareData)) {
      showTransferFailure('This browser cannot share the generated payload. Copy it instead.')
      return
    }
    try {
      await navigator.share(shareData)
      if (!disposed) showToast('Outbound payload shared.')
    } catch (error: unknown) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      showTransferFailure(errorMessage(error, 'The payload could not be shared. Copy it instead.'))
    }
  }

  function showTransferFailure(message: string) {
    showPersistentError(message)
    setWorkflow('Share unavailable', 'Use copy instead', 'The diagnostic is still active and its report has not changed.')
  }

  function delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
      if (abort.signal.aborted) return resolve()
      const timer = setTimeout(finish, ms)
      abort.signal.addEventListener('abort', finish, { once: true })
      function finish() {
        clearTimeout(timer)
        abort.signal.removeEventListener('abort', finish)
        resolve()
      }
    })
  }

  function getSelectedStrategy(): Strategy {
    const strategy = strategies.find(({ id }) => id === $('#manual-strategy').value)
    if (!strategy) throw new Error('Select a supported ICE strategy.')
    return strategy
  }

  function renderStunDiscovery(session: Probe) {
    if (session.strategy.id === 'lan') {
      setStunValue('#manual-stun-result', 'Not requested', 'neutral')
      setStunValue('#manual-stun-server', 'None — LAN-only mode', 'neutral')
      setStunValue('#manual-stun-path', 'STUN disabled', 'neutral')
      return
    }

    if (session.localCandidates.srflx > 0) {
      const count = session.localCandidates.srflx
      setStunValue('#manual-stun-result', `Successful — ${count} server-reflexive candidate${count === 1 ? '' : 's'}`, 'success')
      setStunValue(
        '#manual-stun-server',
        session.stunUrls.join(', ') || 'Successful — responder not reported by browser',
        session.stunUrls.length ? 'success' : 'neutral',
      )
      return
    }

    if (session.pc.iceGatheringState === 'complete') {
      setStunValue('#manual-stun-result', 'Unsuccessful — no server-reflexive candidate', 'failure')
      setStunValue('#manual-stun-server', 'No STUN response observed', 'failure')
      return
    }

    const configured = configuredStunUrls()
    setStunValue('#manual-stun-result', 'Checking…', 'pending')
    setStunValue('#manual-stun-server', configured.length ? `Trying ${configured.join(', ')}` : 'No server configured', configured.length ? 'pending' : 'failure')
  }

  function renderSelectedStunPath(pair: CandidatePair | undefined, connectionState: RTCPeerConnectionState) {
    if (probe?.strategy.id === 'lan') return
    if (!pair?.local && !pair?.remote) {
      const finished = connectionState === 'failed' || connectionState === 'closed'
      setStunValue('#manual-stun-path', finished ? 'No successful candidate pair' : 'Waiting for selected pair', finished ? 'failure' : 'pending')
      return
    }
    const usedStunCandidate = pair.local?.type === 'srflx' || pair.remote?.type === 'srflx'
    setStunValue(
      '#manual-stun-path',
      usedStunCandidate ? 'Yes — selected pair uses a STUN-derived candidate' : 'No — selected pair is direct host/peer-reflexive',
      usedStunCandidate ? 'success' : 'neutral',
    )
  }

  function summarizeStun(session: Probe, pair: CandidatePair | undefined) {
    const requested = session.strategy.id === 'stun'
    const successful = requested && session.localCandidates.srflx > 0
    const hasSelectedPair = Boolean(pair?.local || pair?.remote)
    return {
      requested,
      configuredServers: requested ? configuredStunUrls() : [],
      respondingServers: session.stunUrls,
      responderReportingSupported: session.stunUrls.length > 0,
      discoverySuccessful: successful,
      selectedPathUsesStunCandidate: hasSelectedPair
        ? Boolean(pair?.local?.type === 'srflx' || pair?.remote?.type === 'srflx')
        : null,
    }
  }

  function recordReportedStunUrls(session: Probe, pair: CandidatePair | undefined) {
    for (const url of [pair?.local?.url, pair?.remote?.url]) {
      if (url && /^stuns?:/iu.test(url) && !session.stunUrls.includes(url)) session.stunUrls.push(url)
    }
  }

  function configuredStunUrls() {
    return configuration.stunServers.flatMap(({ urls }) => Array.isArray(urls) ? urls : [urls])
  }

  function hasStunConfiguration() {
    return configurationState === 'ready' && configuredStunUrls().length > 0
  }

  function renderVerdict(result: ProbeResult) {
    if (result.connectionState === 'failed' || result.iceConnectionState === 'failed') {
      setVerdict('Failed', 'No direct path established', 'The exchanged candidates did not produce a working direct connection.', 'failure')
      return
    }
    if (result.connectionState !== 'connected') return
    if (!result.dataChannelOpen) {
      setVerdict('Connected', 'Direct transport connected', 'Waiting for the data channel and media checks to finish.', 'pending')
      return
    }

    const videoVerified = result.side === 'offerer'
      ? result.mediaStats.outboundVideoBytes > 0 || result.mediaStats.framesEncoded > 0
      : result.videoReceived
    const path = result.selectedPair ? formatDetailedPair(result.selectedPair) : 'selected path unavailable'
    const latency = Number.isFinite(result.averageDataRttMs) ? `; data RTT ${result.averageDataRttMs} ms` : ''
    const video = videoVerified
      ? 'video transport verified'
      : result.side === 'offerer' && !result.mediaSupported
        ? 'synthetic video unavailable in this browser'
        : 'video transport not yet verified'
    setVerdict(
      'Verified',
      videoVerified ? 'Direct WebRTC works' : 'Direct path and data channel work',
      `${path}${latency}; ${video}.`,
      'success',
    )
    setWorkflow('Complete', 'The direct connection is working', 'Review the selected path below or copy the JSON report for deeper analysis.')
  }

  function setVerdict(
    label: string,
    title: string,
    detail: string,
    tone: 'idle' | 'pending' | 'success' | 'failure',
  ) {
    const verdict = $<HTMLElement>('#manual-verdict')
    verdict.dataset.tone = tone
    $('#manual-verdict-label').textContent = label
    $('#manual-verdict-title').textContent = title
    $('#manual-verdict-detail').textContent = detail
  }

  function setWorkflow(label: string, title: string, detail: string) {
    $('#manual-workflow-label').textContent = label
    $('#manual-workflow-title').textContent = title
    $('#manual-workflow-detail').textContent = detail
  }

  function setReadyWorkflow() {
    if (configurationState === 'loading') {
      setWorkflow('Loading', 'Checking browser readiness', 'Waiting for the public STUN configuration before enabling the diagnostic.')
    } else if ($('#manual-strategy').value === 'lan') {
      setWorkflow('Ready', 'Start a LAN-only check or answer an offer', 'Create an offer here, or paste an offer from the other browser below.')
    } else {
      setWorkflow('Ready', 'Start a STUN-assisted check or answer an offer', 'Create an offer here, or paste an offer from the other browser below.')
    }
  }

  function setStunValue(selector: string, text: string, tone: 'success' | 'failure' | 'pending' | 'neutral' = 'neutral') {
    const element = $<HTMLElement>(selector)
    element.textContent = text
    element.dataset.tone = tone
  }
}

function parseIceConfiguration(value: unknown): IceConfiguration {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('ICE configuration must be an object.')
  const stunServers = (value as { stunServers?: unknown }).stunServers
  if (!Array.isArray(stunServers)) throw new Error('ICE configuration must contain a STUN server list.')
  return {
    stunServers: stunServers.map((server) => {
      if (!server || typeof server !== 'object' || Array.isArray(server)) throw new Error('ICE server entries must be objects.')
      const urls = (server as { urls?: unknown }).urls
      const values = Array.isArray(urls) ? urls : [urls]
      if (!values.length || values.some((url) => typeof url !== 'string' || !/^stuns?:/iu.test(url))) {
        throw new Error('ICE server entries may contain only STUN URLs.')
      }
      return { urls: values as string[] } satisfies RTCIceServer
    }),
  }
}

function browserName() {
  const ua = navigator.userAgent
  if (/Edg\//u.test(ua)) return 'Edge'
  if (/Firefox\//u.test(ua)) return 'Firefox'
  if (/Chrome\//u.test(ua) && !/Edg\//u.test(ua)) return 'Chrome'
  if (/Safari\//u.test(ua) && !/Chrome\//u.test(ua)) return 'Safari'
  return 'Unknown browser'
}

function formatDetailedPair(pair: CandidatePair): string {
  const format = (candidate?: CandidateSummary) => {
    if (!candidate) return '?'
    const endpoint = candidate.address && candidate.port ? ` ${candidate.address}:${candidate.port}` : ''
    const transport = candidate.protocol ? `/${candidate.protocol}` : ''
    const relay = candidate.relayProtocol ? ` relay=${candidate.relayProtocol}` : ''
    return `${candidate.type || '?'}${transport}${endpoint}${relay}`
  }
  return `${format(pair.local)} -> ${format(pair.remote)}${Number.isFinite(pair.currentRoundTripTimeMs) ? ` · ${pair.currentRoundTripTimeMs} ms` : ''}`
}

function formatCandidateCounts(counts: CandidateCounts): string {
  const values = Object.entries(counts).filter(([, count]) => count > 0).map(([type, count]) => `${type}:${count}`)
  return values.join(' ') || 'none'
}

function makeId() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const bytes = new Uint32Array(4)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (value) => value.toString(16)).join('-')
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}
