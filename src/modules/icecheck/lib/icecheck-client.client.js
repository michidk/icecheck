// Browser-only native WebRTC controller mounted by the TanStack Start page.
import {
  MANUAL_PROTOCOL_VERSION,
  decodeSignalEnvelope,
  encodeSignalEnvelope,
} from './manual-codec.js';

const $ = (selector) => document.querySelector(selector);

const PROBE_MS = 7_000;
const READY_TIMEOUT_MS = 4_000;
const REMOTE_RESULT_TIMEOUT_MS = 2_500;
const MANUAL_GATHER_TIMEOUT_MS = 15_000;
const APP_MODE = $('[data-icecheck-mode]')?.dataset.icecheckMode;
const MANUAL_ONLY = APP_MODE === 'manual';
const BASE_PATH = import.meta.env.BASE_URL.replace(/\/$/, '');

function appPath(pathname = '') {
  const suffix = pathname.replace(/^\/+/, '');
  return `${BASE_PATH}/${suffix}` || '/';
}

let socket;
let clientId;
let role;
let roomCode;
let peerConnected = false;
let signalRtt;
let activeProbe;
let running = false;
let configuration = { stunServers: [] };
let configurationLoaded = false;
let manualProbe;
let manualMonitor;
let manualBusy = false;

const report = {
  createdAt: new Date().toISOString(),
  page: location.href,
  secureContext: window.isSecureContext,
  userAgent: navigator.userAgent,
  manualOnly: MANUAL_ONLY,
  signaling: {},
  results: [],
};

const strategyDefinitions = [
  {
    id: 'lan',
    name: 'No ICE server',
    description: 'iceServers: []',
    path: 'host / prflx',
    config: () => ({ iceServers: [], iceTransportPolicy: 'all' }),
  },
  {
    id: 'stun',
    name: 'STUN configured',
    description: 'Direct candidates; no relay',
    path: 'host / srflx / prflx',
    config: () => ({ iceServers: configuration.stunServers, iceTransportPolicy: 'all' }),
  },
];

initialize();

async function initialize() {
  renderEnvironment();
  if (!MANUAL_ONLY) renderStrategies();
  try {
    const response = await fetch(appPath('config'), { cache: 'no-store' });
    configuration = await response.json();
    configurationLoaded = true;
    report.iceConfiguration = {
      stunUrls: configuration.stunServers.flatMap(({ urls }) => Array.isArray(urls) ? urls : [urls]),
    };
    renderEnvironment();
    updateRawReport();
    if (MANUAL_ONLY) syncManualControls();
  } catch (error) {
    configurationLoaded = true;
    renderEnvironment();
    logEvent(`Could not load ICE configuration: ${error.message}`);
    if (MANUAL_ONLY) syncManualControls();
  }
  if (MANUAL_ONLY) {
    $('#signal-status').textContent = 'disabled';
    $('#signal-detail').textContent = 'manual exchange; no WebSocket created';
    report.signaling.disabled = true;
    updateRawReport();
  } else {
    connectSignaling();
  }
}

function renderEnvironment() {
  $('#secure-context').textContent = window.isSecureContext ? 'true' : 'false';
  $('#secure-context').style.color = window.isSecureContext ? 'var(--good)' : 'var(--warn)';
  $('#secure-detail').textContent = location.protocol === 'https:' ? 'HTTPS' : `${location.protocol} (diagnostics still work)`;

  const supported = typeof RTCPeerConnection !== 'undefined';
  $('#webrtc-status').textContent = supported ? 'available' : 'unavailable';
  $('#webrtc-status').style.color = supported ? 'var(--good)' : 'var(--bad)';
  $('#browser-detail').textContent = `${browserName()} · ${navigator.platform || 'unknown platform'}`;

  const stunUrls = configuration.stunServers.flatMap(({ urls }) => Array.isArray(urls) ? urls : [urls]);
  $('#stun-status').textContent = configurationLoaded ? `${stunUrls.length} endpoint${stunUrls.length === 1 ? '' : 's'}` : 'loading';
  $('#stun-status').style.color = stunUrls.length ? 'var(--good)' : 'var(--warn)';
  $('#stun-detail').textContent = stunUrls.join(', ') || (configurationLoaded ? 'none' : 'fetching /config');
}

function browserName() {
  const ua = navigator.userAgent;
  if (/Edg\//.test(ua)) return 'Edge';
  if (/Firefox\//.test(ua)) return 'Firefox';
  if (/Chrome\//.test(ua) && !/Edg\//.test(ua)) return 'Chrome';
  if (/Safari\//.test(ua) && !/Chrome\//.test(ua)) return 'Safari';
  return 'Unknown browser';
}

function signalingUrl() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${location.host}${appPath('signal')}`;
}

function connectSignaling() {
  setSocketStatus('waiting', 'Opening signaling…');
  const startedAt = performance.now();
  socket = new WebSocket(signalingUrl());

  socket.addEventListener('open', () => {
    const openMs = Math.round(performance.now() - startedAt);
    report.signaling.openMs = openMs;
    report.signaling.url = signalingUrl();
    setSocketStatus('good', 'Signaling connected');
    $('#signal-status').textContent = `Connected in ${openMs} ms`;
    $('#signal-status').style.color = 'var(--good)';
    $('#signal-detail').textContent = `${signalingUrl().replace(location.host, 'current host')} · SDP/ICE only`;
    logEvent(`WebSocket opened in ${openMs} ms`);
  });

  socket.addEventListener('message', (event) => {
    let message;
    try { message = JSON.parse(event.data); } catch { return; }
    handleSignalingMessage(message).catch((error) => {
      logEvent(`Handler error: ${error.message}`);
      showToast(error.message);
    });
  });

  socket.addEventListener('error', () => {
    report.signaling.error = 'WebSocket error';
    setSocketStatus('bad', 'Signaling failed');
    $('#signal-status').textContent = 'Connection failed';
    $('#signal-status').style.color = 'var(--bad)';
    logEvent('WebSocket signaling error');
  });

  socket.addEventListener('close', () => {
    setSocketStatus('bad', 'Signaling offline');
    $('#signal-status').textContent = 'Disconnected';
    $('#signal-status').style.color = 'var(--bad)';
    setPeerConnected(false);
    cleanupProbe();
    logEvent('WebSocket signaling closed');
  });
}

async function handleSignalingMessage(message) {
  switch (message.type) {
    case 'hello':
      clientId = message.clientId;
      $('#create-room').disabled = false;
      $('#join-form button').disabled = false;
      logEvent(`Signaling identity ${shortId(clientId)}`);
      joinFromPath();
      break;
    case 'room-created':
      enterRoom('host', message.roomCode);
      break;
    case 'room-joined':
      enterRoom('guest', message.roomCode);
      setPeerConnected(true);
      runSignalingPing();
      break;
    case 'join-error':
      showToast(message.message);
      break;
    case 'peer-joined':
      setPeerConnected(true);
      runSignalingPing();
      break;
    case 'peer-left':
      setPeerConnected(false);
      cleanupProbe();
      break;
    case 'room-closed':
      setPeerConnected(false);
      cleanupProbe();
      $('#room-state').textContent = 'The host closed this room';
      $('#room-detail').textContent = 'Return home to start another diagnostic session.';
      break;
    case 'signal-ping':
      send({ type: 'signal-pong', pingId: message.pingId, sentAt: message.sentAt });
      break;
    case 'signal-pong':
      if (message.pingId !== report.signaling.pendingPingId) break;
      signalRtt = Math.max(0, Math.round(performance.now() - report.signaling.pendingPingAt));
      report.signaling.rttMs = signalRtt;
      $('#signal-detail').textContent = `Round trip ${signalRtt} ms · /signal`;
      logEvent(`Signaling round trip ${signalRtt} ms`);
      updateRawReport();
      break;
    case 'probe-start':
      await startGuestProbe(message);
      break;
    case 'probe-ready':
      if (activeProbe?.testId === message.testId) activeProbe.readyResolve(true);
      break;
    case 'probe-description':
      await acceptDescription(message);
      break;
    case 'probe-candidate':
      await acceptRemoteCandidate(message);
      break;
    case 'probe-finish':
      await finishGuestProbe(message);
      break;
    case 'probe-result':
      if (activeProbe?.testId === message.testId) activeProbe.remoteResultResolve(message.result);
      break;
    case 'error':
      showToast(message.message);
      logEvent(`Server: ${message.message}`);
      break;
  }
}

function send(message) {
  if (socket?.readyState !== WebSocket.OPEN) throw new Error('Signaling is not connected.');
  socket.send(JSON.stringify(message));
}

function joinFromPath() {
  if (role || !clientId) return;
  const relativePath = location.pathname.startsWith(BASE_PATH)
    ? location.pathname.slice(BASE_PATH.length) || '/'
    : location.pathname;
  const match = relativePath.match(/^\/room\/([A-Za-z0-9]{4,8})\/?$/);
  if (match) send({ type: 'join-room', roomCode: match[1] });
}

function enterRoom(nextRole, code) {
  role = nextRole;
  roomCode = code;
  report.role = role;
  report.roomCode = roomCode;
  updateRawReport();
  $('#setup-panel').hidden = true;
  $('#room-panel').hidden = false;
  $('#tests-section').hidden = false;
  $('#room-code').textContent = formatRoomCode(code);
  $('#role-label').textContent = role === 'host' ? 'Host device' : 'Second device';
  $('#host-controls').hidden = role !== 'host';
  document.querySelectorAll('.run-one').forEach((button) => { button.hidden = role !== 'host'; });

  if (role === 'host') {
    $('#room-state').textContent = 'Waiting for the second device';
    $('#room-detail').textContent = 'Open this link on the device you want to test against.';
    $('#share-row').hidden = false;
    $('#share-link').value = `${location.origin}${appPath(`room/${code}`)}`;
    history.replaceState({}, '', appPath(`room/${code}`));
  } else {
    $('#room-state').textContent = 'Connected to the test room';
    $('#room-detail').textContent = 'Keep this page open while the host runs the matrix.';
    $('#share-row').hidden = true;
  }
  logEvent(`${role === 'host' ? 'Created' : 'Joined'} room ${code}`);
}

function setPeerConnected(connected) {
  peerConnected = connected;
  $('#run-all').disabled = !connected || running;
  document.querySelectorAll('.run-one').forEach((button) => { button.disabled = !connected || running; });
  if (!roomCode) return;
  if (connected) {
    $('#room-state').textContent = 'Both devices are connected';
    $('#room-detail').textContent = role === 'host'
      ? 'Signaling works. You can run the connection matrix now.'
      : 'Waiting for the host to start the connection matrix.';
    logEvent('Second device present on signaling channel');
  } else {
    $('#room-state').textContent = role === 'host' ? 'Waiting for the second device' : 'Host disconnected';
    $('#room-detail').textContent = role === 'host'
      ? 'Open the room link on the second device.'
      : 'The diagnostic session cannot continue.';
    logEvent('Second device left the signaling channel');
  }
}

function runSignalingPing() {
  const pingId = makeId();
  report.signaling.pendingPingId = pingId;
  report.signaling.pendingPingAt = performance.now();
  send({ type: 'signal-ping', pingId, sentAt: Date.now() });
}

function renderStrategies() {
  $('#strategy-list').innerHTML = strategyDefinitions.map((strategy, index) => `
    <article class="strategy" data-strategy="${strategy.id}">
      <div class="strategy-name">
        <span class="strategy-index">${index + 1}</span>
        <div><strong>${strategy.name}</strong><small>${strategy.description}</small></div>
      </div>
      <div class="strategy-path">${strategy.path}</div>
      <div class="strategy-result">
        <span class="result-badge idle"><i></i><span>Not run</span></span>
        <p>Waiting for two connected devices.</p>
      </div>
      <button class="button secondary run-one" type="button" data-run="${strategy.id}" disabled>Run</button>
    </article>
  `).join('');
}

async function runAllStrategies() {
  if (running || !peerConnected || role !== 'host') return;
  running = true;
  setRunningControls();
  report.results = [];
  for (const strategy of strategyDefinitions) {
    if (!peerConnected) break;
    await executeStrategy(strategy);
    await delay(500);
  }
  running = false;
  setRunningControls();
  showToast('Diagnostic matrix complete.');
}

async function runOneStrategy(strategyId) {
  if (running || !peerConnected || role !== 'host') return;
  const strategy = strategyDefinitions.find(({ id }) => id === strategyId);
  if (!strategy) return;
  running = true;
  setRunningControls();
  await executeStrategy(strategy);
  running = false;
  setRunningControls();
}

function setRunningControls() {
  $('#run-all').disabled = running || !peerConnected;
  $('#run-all').textContent = running ? 'Running tests…' : 'Run all tests';
  document.querySelectorAll('.run-one').forEach((button) => { button.disabled = running || !peerConnected; });
}

async function executeStrategy(strategy) {
  cleanupProbe();
  setStrategyStatus(strategy.id, 'running', 'Negotiating…', 'Creating fresh ICE candidates.');
  const testId = makeId();
  activeProbe = createProbe(strategy, testId, true);
  logEvent(`${strategy.name}: starting`);
  send({ type: 'probe-start', testId, strategyId: strategy.id });

  const ready = await withTimeout(activeProbe.readyPromise, READY_TIMEOUT_MS, false);
  if (ready) {
    try {
      await makeOffer(activeProbe);
      await delay(PROBE_MS);
    } catch (error) {
      activeProbe.errors.push(`Offer failed: ${error.message}`);
    }
  } else {
    activeProbe.errors.push('Second device did not prepare the peer connection.');
  }

  send({ type: 'probe-finish', testId });
  const localResult = await collectProbeResult(activeProbe);
  const remoteResult = await withTimeout(activeProbe.remoteResultPromise, REMOTE_RESULT_TIMEOUT_MS, undefined);
  const result = summarizeResult(strategy, localResult, remoteResult);
  report.results = report.results.filter(({ strategyId }) => strategyId !== strategy.id);
  report.results.push(result);
  renderResult(result);
  renderDiagnosis();
  updateRawReport();
  logEvent(`${strategy.name}: ${result.verdict} — ${result.summary}`);
  cleanupProbe();
}

async function startGuestProbe(message) {
  const strategy = strategyDefinitions.find(({ id }) => id === message.strategyId);
  if (!strategy) return;
  cleanupProbe();
  setStrategyStatus(strategy.id, 'running', 'Running on host…', 'Preparing this device for the probe.');
  activeProbe = createProbe(strategy, message.testId, false);
  logEvent(`${strategy.name}: prepared as second device`);
  send({ type: 'probe-ready', testId: message.testId });
}

function createProbe(strategy, testId, initiator, signalingMode = 'websocket') {
  const rtcConfig = { ...strategy.config(), iceCandidatePoolSize: 2 };
  const pc = new RTCPeerConnection(rtcConfig);
  const probe = {
    testId,
    strategy,
    initiator,
    signalingMode,
    pc,
    channel: undefined,
    channelOpen: false,
    videoNegotiated: false,
    videoReceived: false,
    mediaSupported: false,
    localCandidates: emptyCandidateCounts(),
    remoteCandidates: emptyCandidateCounts(),
    pendingCandidates: [],
    stateHistory: [],
    errors: [],
    pingRtts: [],
    pongCount: 0,
    readyPromise: undefined,
    readyResolve: undefined,
    remoteResultPromise: undefined,
    remoteResultResolve: undefined,
    gatheringPromise: undefined,
    gatheringResolve: undefined,
    synthetic: undefined,
  };

  probe.readyPromise = new Promise((resolve) => { probe.readyResolve = resolve; });
  probe.remoteResultPromise = new Promise((resolve) => { probe.remoteResultResolve = resolve; });
  probe.gatheringPromise = new Promise((resolve) => { probe.gatheringResolve = resolve; });

  pc.onicecandidate = ({ candidate }) => {
    if (candidate) countCandidate(probe.localCandidates, candidate);
    else probe.gatheringResolve(true);
    if (signalingMode === 'websocket') {
      send({ type: 'probe-candidate', testId, candidate: candidate?.toJSON() || null });
    } else {
      updateManualStatus(probe);
    }
  };
  pc.onicecandidateerror = ({ errorCode, errorText, url }) => {
    const error = `ICE ${errorCode || ''} ${errorText || 'candidate error'}${url ? ` (${url})` : ''}`.trim();
    probe.errors.push(error);
    logEvent(`${strategy.name}: ${error}`);
  };
  for (const eventName of ['connectionstatechange', 'iceconnectionstatechange', 'icegatheringstatechange', 'signalingstatechange']) {
    pc.addEventListener(eventName, () => {
      recordProbeState(probe);
      if (pc.iceGatheringState === 'complete') probe.gatheringResolve(true);
      if (signalingMode === 'manual') updateManualStatus(probe);
    });
  }
  pc.ontrack = ({ streams, track }) => {
    probe.videoNegotiated = true;
    track.onunmute = () => {
      probe.videoReceived = true;
      if (signalingMode === 'manual') updateManualStatus(probe);
    };
    const stream = streams[0] || new MediaStream([track]);
    $('#probe-video').srcObject = stream;
    $('#probe-video').play().then(() => {
      if (typeof $('#probe-video').requestVideoFrameCallback === 'function') {
        $('#probe-video').requestVideoFrameCallback(() => {
          probe.videoReceived = true;
          if (signalingMode === 'manual') updateManualStatus(probe);
        });
      }
    }).catch(() => {});
    logEvent(`${strategy.name}: remote ${track.kind} track negotiated`);
  };

  if (initiator) {
    setupDataChannel(probe, pc.createDataChannel('diagnostic', { ordered: true }));
    probe.synthetic = createSyntheticVideo();
    probe.mediaSupported = Boolean(probe.synthetic?.stream);
    if (probe.synthetic?.stream) {
      for (const track of probe.synthetic.stream.getTracks()) pc.addTrack(track, probe.synthetic.stream);
    }
  } else {
    pc.ondatachannel = ({ channel }) => setupDataChannel(probe, channel);
  }
  recordProbeState(probe);
  return probe;
}

function setupDataChannel(probe, channel) {
  probe.channel = channel;
  channel.onopen = () => {
    probe.channelOpen = true;
    logEvent(`${probe.strategy.name}: data channel open`);
    if (probe.signalingMode === 'manual') updateManualStatus(probe);
    if (probe.initiator) sendProbePings(probe);
  };
  channel.onclose = () => {
    logEvent(`${probe.strategy.name}: data channel closed`);
    if (probe.signalingMode === 'manual') updateManualStatus(probe);
  };
  channel.onerror = () => {
    probe.errors.push('Data channel error.');
    if (probe.signalingMode === 'manual') updateManualStatus(probe);
  };
  channel.onmessage = ({ data }) => {
    let message;
    try { message = JSON.parse(data); } catch { return; }
    if (message.kind === 'ping' && !probe.initiator) {
      channel.send(JSON.stringify({ kind: 'pong', sequence: message.sequence, sentAt: message.sentAt }));
    } else if (message.kind === 'pong' && probe.initiator) {
      probe.pongCount += 1;
      probe.pingRtts.push(Math.max(0, performance.now() - message.sentAt));
    }
  };
}

async function sendProbePings(probe) {
  for (let sequence = 1; sequence <= 3; sequence += 1) {
    if (probe.channel?.readyState !== 'open') break;
    probe.channel.send(JSON.stringify({ kind: 'ping', sequence, sentAt: performance.now() }));
    await delay(250);
  }
}

function createSyntheticVideo() {
  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 180;
  if (typeof canvas.captureStream !== 'function') return undefined;
  const context = canvas.getContext('2d');
  let frame = 0;
  const draw = () => {
    frame += 1;
    const hue = (frame * 5) % 360;
    context.fillStyle = `hsl(${hue} 62% 44%)`;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = 'white';
    context.font = '700 24px system-ui';
    context.fillText('WebRTC probe', 70, 83);
    context.font = '14px ui-monospace';
    context.fillText(new Date().toISOString().slice(11, 23), 91, 110);
  };
  draw();
  const timer = setInterval(draw, 100);
  return { stream: canvas.captureStream(10), timer };
}

async function makeOffer(probe) {
  const offer = await probe.pc.createOffer();
  await probe.pc.setLocalDescription(offer);
  send({ type: 'probe-description', testId: probe.testId, description: probe.pc.localDescription });
}

async function acceptDescription(message) {
  const probe = activeProbe;
  if (!probe || probe.testId !== message.testId) return;
  await probe.pc.setRemoteDescription(message.description);
  await flushRemoteCandidates(probe);
  if (message.description.type === 'offer') {
    const answer = await probe.pc.createAnswer();
    await probe.pc.setLocalDescription(answer);
    send({ type: 'probe-description', testId: probe.testId, description: probe.pc.localDescription });
  }
}

async function acceptRemoteCandidate(message) {
  const probe = activeProbe;
  if (!probe || probe.testId !== message.testId) return;
  if (message.candidate) countCandidate(probe.remoteCandidates, message.candidate);
  if (!probe.pc.remoteDescription) {
    probe.pendingCandidates.push(message.candidate);
    return;
  }
  try {
    await probe.pc.addIceCandidate(message.candidate);
  } catch (error) {
    probe.errors.push(`Remote candidate rejected: ${error.message}`);
  }
}

async function flushRemoteCandidates(probe) {
  const candidates = probe.pendingCandidates.splice(0);
  for (const candidate of candidates) {
    try { await probe.pc.addIceCandidate(candidate); }
    catch (error) { probe.errors.push(`Queued candidate rejected: ${error.message}`); }
  }
}

// Manual signaling deliberately uses non-trickle ICE. Waiting for gathering to
// finish puts every candidate into the SDP so each side exchanges one payload.
async function waitForManualGathering(probe) {
  if (probe.pc.iceGatheringState === 'complete') return true;
  const complete = await withTimeout(probe.gatheringPromise, MANUAL_GATHER_TIMEOUT_MS, false);
  if (!complete) probe.errors.push(`ICE gathering did not finish within ${MANUAL_GATHER_TIMEOUT_MS / 1000} seconds.`);
  return complete;
}

function makeManualEnvelope(kind, probe, iceComplete) {
  return {
    version: MANUAL_PROTOCOL_VERSION,
    kind,
    sessionId: probe.testId,
    strategyId: probe.strategy.id,
    createdAt: new Date().toISOString(),
    iceComplete,
    description: {
      type: probe.pc.localDescription.type,
      sdp: probe.pc.localDescription.sdp,
    },
  };
}

async function createManualOffer() {
  if (manualBusy || !configurationLoaded) return;
  setManualBusy(true, 'Gathering offer ICE…');
  cleanupManualProbe();
  $('#manual-remote-payload').value = '';

  try {
    const strategy = strategyDefinitions.find(({ id }) => id === $('#manual-strategy').value);
    manualProbe = createProbe(strategy, makeId(), true, 'manual');
    manualProbe.manualRole = 'offerer';
    startManualMonitor(manualProbe);

    const offer = await manualProbe.pc.createOffer();
    await manualProbe.pc.setLocalDescription(offer);
    const iceComplete = await waitForManualGathering(manualProbe);
    const envelope = makeManualEnvelope('offer', manualProbe, iceComplete);
    setManualLocalPayload(envelope);
    logEvent(`Manual ${strategy.name}: offer ready (${formatCandidateCounts(manualProbe.localCandidates)})`);
  } catch (error) {
    setManualFailure(error);
  } finally {
    setManualBusy(false);
    updateManualStatus(manualProbe);
  }
}

async function processManualPayload() {
  if (manualBusy || !configurationLoaded) return;
  setManualBusy(true, 'Processing payload…');
  try {
    const envelope = decodeSignalEnvelope($('#manual-remote-payload').value);
    if (envelope.kind === 'offer') await acceptManualOffer(envelope);
    else await applyManualAnswer(envelope);
  } catch (error) {
    setManualFailure(error);
  } finally {
    setManualBusy(false);
    updateManualStatus(manualProbe);
  }
}

async function acceptManualOffer(envelope) {
  cleanupManualProbe();
  const strategy = strategyDefinitions.find(({ id }) => id === envelope.strategyId);
  $('#manual-strategy').value = strategy.id;
  manualProbe = createProbe(strategy, envelope.sessionId, false, 'manual');
  manualProbe.manualRole = 'answerer';
  manualProbe.remoteCandidates = countCandidatesInSdp(envelope.description.sdp);
  startManualMonitor(manualProbe);

  await manualProbe.pc.setRemoteDescription(envelope.description);
  const answer = await manualProbe.pc.createAnswer();
  await manualProbe.pc.setLocalDescription(answer);
  const iceComplete = await waitForManualGathering(manualProbe);
  setManualLocalPayload(makeManualEnvelope('answer', manualProbe, iceComplete));
  logEvent(`Manual ${strategy.name}: answer ready (${formatCandidateCounts(manualProbe.localCandidates)})`);
}

async function applyManualAnswer(envelope) {
  if (!manualProbe || manualProbe.signalingMode !== 'manual' || !manualProbe.initiator) {
    throw new Error('Create an offer on this browser before applying an answer.');
  }
  if (envelope.sessionId !== manualProbe.testId) throw new Error('This answer belongs to a different manual session.');
  if (envelope.strategyId !== manualProbe.strategy.id) throw new Error('The answer uses a different ICE strategy.');
  if (manualProbe.pc.remoteDescription) throw new Error('An answer has already been applied to this session.');

  manualProbe.remoteCandidates = countCandidatesInSdp(envelope.description.sdp);
  await manualProbe.pc.setRemoteDescription(envelope.description);
  $('#manual-local-meta').textContent = `offer · answer applied · ${$('#manual-local-payload').value.length} chars`;
  logEvent(`Manual ${manualProbe.strategy.name}: answer applied; ICE checks running`);
  await refreshManualReport(manualProbe);
}

function setManualLocalPayload(envelope) {
  const encoded = encodeSignalEnvelope(envelope);
  $('#manual-local-payload').value = encoded;
  $('#manual-local-meta').textContent = `${envelope.kind} · ${encoded.length} chars · ICE ${envelope.iceComplete ? 'complete' : 'timed out'}`;
  syncManualControls();
}

function countCandidatesInSdp(sdp = '') {
  const counts = emptyCandidateCounts();
  for (const line of sdp.split(/\r?\n/u)) {
    if (!line.startsWith('a=candidate:')) continue;
    const type = line.match(/\btyp\s+(host|srflx|prflx|relay)\b/u)?.[1] || 'unknown';
    counts[type] += 1;
  }
  return counts;
}

function setManualBusy(busy, label = '') {
  manualBusy = busy;
  if (label) $('#manual-report').textContent = label;
  syncManualControls();
}

function syncManualControls() {
  $('#manual-create-offer').disabled = manualBusy || !configurationLoaded;
  $('#manual-process-payload').disabled = manualBusy || !configurationLoaded || !$('#manual-remote-payload').value.trim();
  $('#manual-copy-payload').disabled = !$('#manual-local-payload').value;
}

function updateManualStatus(probe) {
  if (!probe || probe !== manualProbe) return;
  $('#manual-role').textContent = probe.manualRole;
  $('#manual-strategy-status').textContent = `${probe.strategy.id} (${probe.strategy.path})`;
  $('#manual-connection').textContent = probe.pc.connectionState;
  $('#manual-ice').textContent = probe.pc.iceConnectionState;
  $('#manual-gathering').textContent = probe.pc.iceGatheringState;
  $('#manual-data').textContent = probe.channel?.readyState || 'not created';
  $('#manual-video').textContent = probe.videoReceived ? 'bytes received' : probe.videoNegotiated ? 'negotiated' : probe.mediaSupported ? 'sending synthetic track' : 'not negotiated';
  $('#manual-local-candidates').textContent = formatCandidateCounts(probe.localCandidates);
  $('#manual-remote-candidates').textContent = formatCandidateCounts(probe.remoteCandidates);
}

function startManualMonitor(probe) {
  clearInterval(manualMonitor);
  updateManualStatus(probe);
  refreshManualReport(probe);
  manualMonitor = setInterval(() => refreshManualReport(probe), 1_000);
}

async function refreshManualReport(probe) {
  if (!probe || probe !== manualProbe || probe.pc.connectionState === 'closed') return;
  const result = await collectProbeResult(probe);
  if (probe !== manualProbe) return;

  const manualResult = {
    mode: 'manual-non-trickle',
    protocolVersion: MANUAL_PROTOCOL_VERSION,
    sessionId: probe.testId,
    strategyId: probe.strategy.id,
    role: probe.manualRole,
    sampledAt: new Date().toISOString(),
    result,
  };
  report.manual = manualResult;
  $('#manual-report').textContent = JSON.stringify(manualResult, null, 2);
  const pair = result.selectedPair;
  $('#manual-selected-pair').textContent = pair ? formatDetailedPair(pair) : 'none';
  updateManualStatus(probe);
  updateRawReport();
}

function formatDetailedPair(pair) {
  const format = (candidate) => {
    if (!candidate) return '?';
    const endpoint = candidate.address && candidate.port ? ` ${candidate.address}:${candidate.port}` : '';
    const transport = candidate.protocol ? `/${candidate.protocol}` : '';
    const relay = candidate.relayProtocol ? ` relay=${candidate.relayProtocol}` : '';
    return `${candidate.type || '?'}${transport}${endpoint}${relay}`;
  };
  return `${format(pair.local)} -> ${format(pair.remote)}${Number.isFinite(pair.currentRoundTripTimeMs) ? ` · ${pair.currentRoundTripTimeMs} ms` : ''}`;
}

function setManualFailure(error) {
  const message = error?.message || 'Manual signaling failed.';
  $('#manual-report').textContent = JSON.stringify({ error: message, at: new Date().toISOString() }, null, 2);
  logEvent(`Manual signaling: ${message}`);
  showToast(message);
}

function resetManualMode() {
  cleanupManualProbe();
  $('#manual-local-payload').value = '';
  $('#manual-remote-payload').value = '';
  $('#manual-local-meta').textContent = 'Create or accept an offer first.';
  $('#manual-role').textContent = 'idle';
  $('#manual-strategy-status').textContent = 'none';
  $('#manual-connection').textContent = 'new';
  $('#manual-ice').textContent = 'new';
  $('#manual-gathering').textContent = 'new';
  $('#manual-data').textContent = 'closed';
  $('#manual-video').textContent = 'not negotiated';
  $('#manual-local-candidates').textContent = 'none';
  $('#manual-remote-candidates').textContent = 'none';
  $('#manual-selected-pair').textContent = 'none';
  $('#manual-report').textContent = 'No manual connection is active.';
  delete report.manual;
  updateRawReport();
  syncManualControls();
}

function cleanupManualProbe() {
  clearInterval(manualMonitor);
  manualMonitor = undefined;
  destroyProbe(manualProbe);
  manualProbe = undefined;
}

async function finishGuestProbe(message) {
  const probe = activeProbe;
  if (!probe || probe.testId !== message.testId) return;
  const result = await collectProbeResult(probe);
  send({ type: 'probe-result', testId: probe.testId, result });
  const summarized = summarizeResult(probe.strategy, undefined, result);
  report.results = report.results.filter(({ strategyId }) => strategyId !== probe.strategy.id);
  report.results.push(summarized);
  renderResult(summarized);
  renderDiagnosis();
  updateRawReport();
  logEvent(`${probe.strategy.name}: second-device result sent`);
  cleanupProbe();
}

async function collectProbeResult(probe) {
  const selectedPair = await getSelectedPair(probe.pc);
  const mediaStats = await getMediaStats(probe.pc);
  probe.videoReceived ||= mediaStats.inboundVideoBytes > 0 || mediaStats.framesDecoded > 0;
  return {
    side: probe.initiator ? 'host' : 'guest',
    connectionState: probe.pc.connectionState,
    iceConnectionState: probe.pc.iceConnectionState,
    iceGatheringState: probe.pc.iceGatheringState,
    signalingState: probe.pc.signalingState,
    dataChannelOpen: probe.channelOpen,
    pongs: probe.pongCount,
    averageDataRttMs: probe.pingRtts.length
      ? Math.round(probe.pingRtts.reduce((sum, value) => sum + value, 0) / probe.pingRtts.length)
      : undefined,
    mediaSupported: probe.mediaSupported,
    videoNegotiated: probe.videoNegotiated,
    videoReceived: probe.videoReceived,
    mediaStats,
    localCandidates: probe.localCandidates,
    remoteCandidates: probe.remoteCandidates,
    selectedPair,
    errors: probe.errors,
    stateHistory: probe.stateHistory,
    userAgent: navigator.userAgent,
  };
}

async function getMediaStats(pc) {
  const result = { inboundVideoBytes: 0, outboundVideoBytes: 0, framesDecoded: 0, framesEncoded: 0 };
  try {
    const stats = await pc.getStats();
    for (const stat of stats.values()) {
      const kind = stat.kind || stat.mediaType;
      if (kind !== 'video') continue;
      if (stat.type === 'inbound-rtp' && !stat.isRemote) {
        result.inboundVideoBytes += stat.bytesReceived || 0;
        result.framesDecoded += stat.framesDecoded || 0;
      } else if (stat.type === 'outbound-rtp' && !stat.isRemote) {
        result.outboundVideoBytes += stat.bytesSent || 0;
        result.framesEncoded += stat.framesEncoded || 0;
      }
    }
  } catch {}
  return result;
}

async function getSelectedPair(pc) {
  try {
    const stats = await pc.getStats();
    let pair;
    for (const stat of stats.values()) {
      if (stat.type === 'transport' && stat.selectedCandidatePairId) pair = stats.get(stat.selectedCandidatePairId);
    }
    if (!pair) {
      for (const stat of stats.values()) {
        if (stat.type === 'candidate-pair' && stat.state === 'succeeded' && (stat.nominated || stat.selected)) pair = stat;
      }
    }
    if (!pair) return undefined;
    const local = stats.get(pair.localCandidateId);
    const remote = stats.get(pair.remoteCandidateId);
    return {
      local: summarizeCandidate(local),
      remote: summarizeCandidate(remote),
      currentRoundTripTimeMs: Number.isFinite(pair.currentRoundTripTime)
        ? Math.round(pair.currentRoundTripTime * 1000)
        : undefined,
      availableOutgoingBitrate: pair.availableOutgoingBitrate,
    };
  } catch (error) {
    return { error: error.message };
  }
}

function summarizeCandidate(candidate) {
  if (!candidate) return undefined;
  return {
    type: candidate.candidateType,
    protocol: candidate.protocol,
    address: candidate.address || candidate.ip,
    port: candidate.port,
    networkType: candidate.networkType,
    relayProtocol: candidate.relayProtocol,
  };
}

function summarizeResult(strategy, local, remote) {
  const primary = local || remote;
  const bothData = local ? local.dataChannelOpen && remote?.dataChannelOpen : remote?.dataChannelOpen;
  const mediaOkay = local ? remote?.videoReceived || local.mediaSupported === false : remote?.videoReceived;
  let verdict = 'fail';
  let summary = 'ICE connection did not become usable.';

  if (bothData && mediaOkay) {
    verdict = 'pass';
    summary = 'The data channel opened and the peer confirmed generated video.';
  } else if (bothData) {
    verdict = 'partial';
    summary = 'Data channel worked, but generated video was not confirmed.';
  } else if (primary?.connectionState === 'connected' || primary?.iceConnectionState === 'connected' || primary?.iceConnectionState === 'completed') {
    verdict = 'partial';
    summary = 'ICE connected, but the data-channel probe did not complete.';
  } else if (!remote && local) {
    summary = 'The second device did not return a result.';
  }

  return {
    strategyId: strategy.id,
    strategyName: strategy.name,
    verdict,
    summary,
    signalingRttMs: signalRtt,
    local,
    remote,
    completedAt: new Date().toISOString(),
  };
}

function renderResult(result) {
  const card = document.querySelector(`[data-strategy="${result.strategyId}"]`);
  if (!card) return;
  const resultBox = card.querySelector('.strategy-result');
  resultBox.innerHTML = `
    <span class="result-badge ${result.verdict}"><i></i><span>${verdictLabel(result.verdict)}</span></span>
    <p>${escapeHtml(result.summary)}</p>
  `;
  card.querySelector('.result-details')?.remove();
  card.querySelector('.result-raw')?.remove();

  const primary = result.local || result.remote;
  const pair = result.local?.selectedPair || result.remote?.selectedPair;
  const localType = pair?.local?.type || candidateTypes(primary?.localCandidates);
  const remoteType = pair?.remote?.type || candidateTypes(primary?.remoteCandidates);
  const rtt = result.local?.averageDataRttMs ?? pair?.currentRoundTripTimeMs;
  const localCandidateSummary = formatCandidateCounts(primary?.localCandidates);
  const remoteCandidateSummary = formatCandidateCounts(primary?.remoteCandidates);
  const inboundVideoBytes = result.remote?.mediaStats?.inboundVideoBytes || result.local?.mediaStats?.inboundVideoBytes || 0;
  const videoLabel = inboundVideoBytes > 0
    ? `${formatBytes(inboundVideoBytes)} received`
    : result.remote?.videoReceived ? 'frame received' : primary?.mediaSupported === false ? 'unsupported' : 'not confirmed';
  const details = document.createElement('div');
  details.className = 'result-details';
  details.innerHTML = `
    <div><span>Selected path</span><b>${escapeHtml(formatPair(pair, localType, remoteType))}</b></div>
    <div><span>ICE state</span><b>${escapeHtml(primary?.iceConnectionState || 'unknown')}</b></div>
    <div><span>Local candidates</span><b>${escapeHtml(localCandidateSummary)}</b></div>
    <div><span>Remote candidates</span><b>${escapeHtml(remoteCandidateSummary)}</b></div>
    <div><span>Data RTT</span><b>${Number.isFinite(rtt) ? `${Math.round(rtt)} ms` : 'not measured'}</b></div>
    <div><span>Video</span><b>${escapeHtml(videoLabel)}</b></div>
  `;
  card.append(details);

  const raw = document.createElement('details');
  const rawSummary = document.createElement('summary');
  const rawBody = document.createElement('pre');
  raw.className = 'result-raw';
  rawSummary.textContent = 'Raw probe result';
  rawBody.textContent = JSON.stringify(result, null, 2);
  raw.append(rawSummary, rawBody);
  card.append(raw);
}

function renderDiagnosis() {
  const results = Object.fromEntries(report.results.map((result) => [result.strategyId, result]));
  const passed = (id) => results[id]?.verdict === 'pass';
  const attempted = (id) => Boolean(results[id]);
  let title;
  let detail;
  let tone = 'default';

  if (passed('stun')) {
    title = 'The STUN-configured probe connected directly.';
    detail = 'Data and video succeeded without TURN. Inspect Selected path: srflx means STUN contributed; host means the browsers used a local path.';
    tone = 'good';
  } else if (passed('lan')) {
    title = 'The no-server probe passed.';
    detail = attempted('stun')
      ? 'Host or peer-reflexive candidates worked, but the STUN-configured run failed. Compare candidate errors and state history; this difference may be transient.'
      : 'Run the STUN-configured probe next to test candidate gathering with the configured endpoint.';
  } else if (['lan', 'stun'].every(attempted)) {
    title = 'Signaling succeeded; both direct WebRTC probes failed.';
    detail = 'The browsers exchanged SDP and candidates, but found no usable direct pair. Inspect ICE errors, candidate counts, firewall policy, and NAT behavior. No TURN relay is configured.';
    tone = 'bad';
  } else {
    const completed = report.results.length;
    title = `${completed} of 2 strategies completed.`;
    detail = 'Run the remaining strategies for a confident conclusion.';
  }

  const panel = $('#diagnosis');
  panel.hidden = false;
  panel.dataset.tone = tone;
  $('#diagnosis-title').textContent = title;
  $('#diagnosis-detail').textContent = detail;
}

function verdictLabel(verdict) {
  if (verdict === 'pass') return 'Passed';
  if (verdict === 'partial') return 'Partial';
  return 'Failed';
}

function formatPair(pair, localType, remoteType) {
  if (!localType && !remoteType) return 'No selected candidate pair';
  const protocol = pair?.local?.protocol || pair?.remote?.protocol;
  return `${localType || '?'} → ${remoteType || '?'}${protocol ? ` over ${protocol.toUpperCase()}` : ''}`;
}

function candidateTypes(counts) {
  if (!counts) return undefined;
  const types = Object.entries(counts).filter(([, count]) => count > 0).map(([type]) => type);
  return types.join('+') || undefined;
}

function formatCandidateCounts(counts) {
  if (!counts) return 'none';
  const values = Object.entries(counts).filter(([, count]) => count > 0).map(([type, count]) => `${type}:${count}`);
  return values.join(' ') || 'none';
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function setStrategyStatus(id, state, label, detail) {
  const card = document.querySelector(`[data-strategy="${id}"]`);
  if (!card) return;
  card.querySelector('.result-details')?.remove();
  card.querySelector('.result-raw')?.remove();
  card.querySelector('.strategy-result').innerHTML = `
    <span class="result-badge ${state}"><i></i><span>${escapeHtml(label)}</span></span>
    <p>${escapeHtml(detail)}</p>
  `;
}

function emptyCandidateCounts() {
  return { host: 0, srflx: 0, prflx: 0, relay: 0, unknown: 0 };
}

function countCandidate(counts, candidate) {
  const type = candidate.type || candidate.candidate?.match(/\btyp\s+(host|srflx|prflx|relay)\b/)?.[1] || 'unknown';
  counts[type] = (counts[type] || 0) + 1;
}

function recordProbeState(probe) {
  const state = {
    atMs: Math.round(performance.now()),
    connection: probe.pc.connectionState,
    ice: probe.pc.iceConnectionState,
    gathering: probe.pc.iceGatheringState,
    signaling: probe.pc.signalingState,
  };
  const previous = probe.stateHistory.at(-1);
  if (!previous || ['connection', 'ice', 'gathering', 'signaling'].some((key) => previous[key] !== state[key])) {
    probe.stateHistory.push(state);
  }
}

function cleanupProbe() {
  if (!activeProbe) return;
  destroyProbe(activeProbe);
  activeProbe = undefined;
}

function destroyProbe(probe) {
  if (!probe) return;
  if (probe.synthetic) {
    clearInterval(probe.synthetic.timer);
    for (const track of probe.synthetic.stream.getTracks()) track.stop();
  }
  try { probe.channel?.close(); } catch {}
  try { probe.pc?.close(); } catch {}
  $('#probe-video').srcObject = null;
}

function setSocketStatus(state, text) {
  const badge = $('#socket-badge');
  badge.className = `badge ${state}`;
  badge.querySelector('span').textContent = text;
}

function formatRoomCode(code) {
  return code.length > 3 ? `${code.slice(0, 3)} ${code.slice(3)}` : code;
}

function shortId(id) {
  return id ? id.slice(0, 8) : 'unknown';
}

function makeId() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = new Uint32Array(4);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16)).join('-');
}

function logEvent(message) {
  const events = $('#events');
  if (!events) return;
  const item = document.createElement('li');
  item.textContent = `${new Date().toLocaleTimeString()}  ${message}`;
  events.append(item);
  while (events.children.length > 200) events.firstElementChild.remove();
  const count = events.children.length;
  $('#event-count').textContent = `${count} ${count === 1 ? 'event' : 'events'}`;
}

function updateRawReport() {
  const output = $('#raw-report');
  if (output) output.textContent = JSON.stringify(report, null, 2);
}

function showToast(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove('show'), 2800);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout(promise, ms, fallback) {
  return Promise.race([promise, delay(ms).then(() => fallback)]);
}

async function copyText(text, confirmation) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    document.body.append(area);
    area.select();
    document.execCommand('copy');
    area.remove();
  }
  showToast(confirmation);
}

$('#create-room')?.addEventListener('click', () => send({ type: 'create-room' }));
$('#join-form')?.addEventListener('submit', (event) => {
  event.preventDefault();
  const code = $('#room-input').value.trim();
  if (code) send({ type: 'join-room', roomCode: code });
});
$('#copy-link')?.addEventListener('click', () => copyText($('#share-link').value, 'Test link copied.'));
$('#room-code')?.addEventListener('click', () => copyText(roomCode, 'Room code copied.'));
$('#run-all')?.addEventListener('click', runAllStrategies);
$('#strategy-list')?.addEventListener('click', (event) => {
  const button = event.target.closest('[data-run]');
  if (button) runOneStrategy(button.dataset.run);
});
$('#copy-report')?.addEventListener('click', () => {
  report.page = location.href;
  report.copiedAt = new Date().toISOString();
  updateRawReport();
  copyText(JSON.stringify(report, null, 2), 'Diagnostic report copied.');
});
$('#manual-create-offer')?.addEventListener('click', createManualOffer);
$('#manual-process-payload')?.addEventListener('click', processManualPayload);
$('#manual-reset')?.addEventListener('click', resetManualMode);
$('#manual-remote-payload')?.addEventListener('input', syncManualControls);
$('#manual-copy-payload')?.addEventListener('click', () => {
  copyText($('#manual-local-payload').value, 'Manual signaling payload copied.');
});
$('#manual-copy-report')?.addEventListener('click', (event) => {
  event.preventDefault();
  event.stopPropagation();
  copyText($('#manual-report').textContent, 'Manual probe report copied.');
});
