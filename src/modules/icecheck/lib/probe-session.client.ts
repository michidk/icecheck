import { countCandidate, emptyCandidateCounts } from './diagnostic-report.ts'
import type { Probe, Strategy } from './diagnostic-types.ts'

export interface ProbeSession extends Probe {
  destroy(): void
  waitForGathering(timeoutMs: number): Promise<boolean>
}

export interface CreateProbeSessionOptions {
  delay(ms: number): Promise<void>
  initiator: boolean
  onUpdate(probe: ProbeSession): void
  strategy: Strategy
  testId: string
  video: HTMLVideoElement
}

export function createProbeSession(options: CreateProbeSessionOptions): ProbeSession {
  const pc = new RTCPeerConnection({ ...options.strategy.config(), iceCandidatePoolSize: 2 })
  const gathering = deferred<boolean>()
  let destroyed = false

  const probe: ProbeSession = {
    testId: options.testId,
    strategy: options.strategy,
    initiator: options.initiator,
    pc,
    channel: undefined,
    channelOpen: false,
    videoNegotiated: false,
    videoReceived: false,
    mediaSupported: false,
    localCandidates: emptyCandidateCounts(),
    remoteCandidates: emptyCandidateCounts(),
    stateHistory: [],
    errors: [],
    pingRtts: [],
    pongCount: 0,
    gatheringPromise: gathering.promise,
    gatheringResolve: gathering.resolve,
    destroy() {
      if (destroyed) return
      destroyed = true
      if (probe.synthetic) {
        clearInterval(probe.synthetic.timer)
        for (const track of probe.synthetic.stream.getTracks()) track.stop()
      }
      try { probe.channel?.close() } catch {}
      try { pc.close() } catch {}
      options.video.srcObject = null
    },
    async waitForGathering(timeoutMs) {
      if (pc.iceGatheringState === 'complete') return true
      const complete = await Promise.race([
        probe.gatheringPromise,
        options.delay(timeoutMs).then(() => false),
      ])
      if (!complete && !destroyed) probe.errors.push(`ICE gathering did not finish within ${timeoutMs / 1000} seconds.`)
      return complete
    },
  }

  pc.onicecandidate = ({ candidate }) => {
    if (destroyed) return
    if (candidate) countCandidate(probe.localCandidates, candidate)
    else probe.gatheringResolve(true)
    options.onUpdate(probe)
  }
  pc.onicecandidateerror = ({ errorCode, errorText, url }) => {
    if (destroyed) return
    const error = `ICE ${errorCode || ''} ${errorText || 'candidate error'}${url ? ` (${url})` : ''}`.trim()
    probe.errors.push(error)
    options.onUpdate(probe)
  }
  for (const eventName of ['connectionstatechange', 'iceconnectionstatechange', 'icegatheringstatechange', 'signalingstatechange']) {
    pc.addEventListener(eventName, () => {
      if (destroyed) return
      recordProbeState(probe)
      if (pc.iceGatheringState === 'complete') probe.gatheringResolve(true)
      options.onUpdate(probe)
    })
  }
  pc.ontrack = ({ streams, track }) => {
    if (destroyed) return
    probe.videoNegotiated = true
    track.onunmute = () => {
      if (destroyed) return
      probe.videoReceived = true
      options.onUpdate(probe)
    }
    options.video.srcObject = streams[0] || new MediaStream([track])
    options.video.play().then(() => {
      options.video.requestVideoFrameCallback?.(() => {
        if (destroyed) return
        probe.videoReceived = true
        options.onUpdate(probe)
      })
    }).catch(() => {})
  }

  if (options.initiator) {
    setupDataChannel(pc.createDataChannel('diagnostic', { ordered: true }))
    probe.synthetic = createSyntheticVideo()
    probe.mediaSupported = Boolean(probe.synthetic?.stream)
    if (probe.synthetic?.stream) {
      for (const track of probe.synthetic.stream.getTracks()) pc.addTrack(track, probe.synthetic.stream)
    }
  } else {
    pc.ondatachannel = ({ channel }) => setupDataChannel(channel)
  }
  recordProbeState(probe)
  return probe

  function setupDataChannel(channel: RTCDataChannel) {
    probe.channel = channel
    channel.onopen = () => {
      if (destroyed) return
      probe.channelOpen = true
      options.onUpdate(probe)
      if (probe.initiator) void sendProbePings(channel)
    }
    channel.onclose = () => {
      if (!destroyed) options.onUpdate(probe)
    }
    channel.onerror = () => {
      if (destroyed) return
      probe.errors.push('Data channel error.')
      options.onUpdate(probe)
    }
    channel.onmessage = ({ data }) => {
      if (destroyed) return
      let message: unknown
      try { message = JSON.parse(String(data)) } catch { return }
      if (!isProbePing(message)) return
      if (message.kind === 'ping' && !probe.initiator) {
        channel.send(JSON.stringify({ kind: 'pong', sequence: message.sequence, sentAt: message.sentAt }))
      } else if (message.kind === 'pong' && probe.initiator) {
        probe.pongCount += 1
        probe.pingRtts.push(Math.max(0, performance.now() - message.sentAt))
      }
    }
  }

  async function sendProbePings(channel: RTCDataChannel) {
    for (let sequence = 1; sequence <= 3; sequence += 1) {
      if (destroyed || channel.readyState !== 'open') break
      channel.send(JSON.stringify({ kind: 'ping', sequence, sentAt: performance.now() }))
      await options.delay(250)
    }
  }
}

function createSyntheticVideo() {
  const canvas = document.createElement('canvas')
  canvas.width = 320
  canvas.height = 180
  if (typeof canvas.captureStream !== 'function') return undefined
  const context = canvas.getContext('2d')
  if (!context) return undefined
  let frame = 0
  const draw = () => {
    frame += 1
    context.fillStyle = `hsl(${(frame * 5) % 360} 62% 44%)`
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.fillStyle = 'white'
    context.font = '700 24px system-ui'
    context.fillText('WebRTC probe', 70, 83)
    context.font = '14px ui-monospace'
    context.fillText(new Date().toISOString().slice(11, 23), 91, 110)
  }
  draw()
  const timer = setInterval(draw, 100)
  return { stream: canvas.captureStream(10), timer }
}

function recordProbeState(probe: Probe) {
  const state = {
    atMs: Math.round(performance.now()),
    connection: probe.pc.connectionState,
    ice: probe.pc.iceConnectionState,
    gathering: probe.pc.iceGatheringState,
    signaling: probe.pc.signalingState,
  }
  const previous = probe.stateHistory.at(-1)
  const keys = ['connection', 'ice', 'gathering', 'signaling'] as const
  if (!previous || keys.some((key) => previous[key] !== state[key])) probe.stateHistory.push(state)
}

function deferred<Value>() {
  let resolve!: (value: Value) => void
  const promise = new Promise<Value>((nextResolve) => { resolve = nextResolve })
  return { promise, resolve }
}

function isProbePing(value: unknown): value is { kind: 'ping' | 'pong'; sequence: number; sentAt: number } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as { kind?: unknown; sequence?: unknown; sentAt?: unknown }
  return (candidate.kind === 'ping' || candidate.kind === 'pong')
    && typeof candidate.sequence === 'number'
    && typeof candidate.sentAt === 'number'
}
