import type { IceStrategyId } from './manual-codec.ts'

export type CandidateKind = 'host' | 'srflx' | 'prflx' | 'relay' | 'unknown'
export type CandidateCounts = Record<CandidateKind, number>

export interface IceConfiguration {
  stunServers: RTCIceServer[]
}

export interface Strategy {
  id: IceStrategyId
  name: string
  path: string
  config(): RTCConfiguration
}

export interface CandidateSummary {
  type?: string
  protocol?: string
  address?: string
  port?: number
  url?: string
  networkType?: string
  relayProtocol?: string
}

export interface CandidatePair {
  local?: CandidateSummary
  remote?: CandidateSummary
  currentRoundTripTimeMs?: number
  availableOutgoingBitrate?: number
  error?: string
}

export interface CandidateStats extends RTCStats {
  address?: string
  candidateType?: string
  ip?: string
  networkType?: string
  port?: number
  protocol?: string
  relayProtocol?: string
  url?: string
}

export interface MediaStats {
  inboundVideoBytes: number
  outboundVideoBytes: number
  framesDecoded: number
  framesEncoded: number
}

export interface ProbeState {
  atMs: number
  connection: RTCPeerConnectionState
  ice: RTCIceConnectionState
  gathering: RTCIceGatheringState
  signaling: RTCSignalingState
}

export interface ProbeResult {
  side: 'offerer' | 'answerer'
  connectionState: RTCPeerConnectionState
  iceConnectionState: RTCIceConnectionState
  iceGatheringState: RTCIceGatheringState
  signalingState: RTCSignalingState
  dataChannelOpen: boolean
  pongs: number
  averageDataRttMs?: number
  mediaSupported: boolean
  videoNegotiated: boolean
  videoReceived: boolean
  mediaStats: MediaStats
  localCandidates: CandidateCounts
  remoteCandidates: CandidateCounts
  selectedPair?: CandidatePair
  errors: string[]
  stateHistory: ProbeState[]
  userAgent: string
}

export interface Probe {
  testId: string
  strategy: Strategy
  initiator: boolean
  pc: RTCPeerConnection
  channel?: RTCDataChannel
  channelOpen: boolean
  videoNegotiated: boolean
  videoReceived: boolean
  mediaSupported: boolean
  localCandidates: CandidateCounts
  remoteCandidates: CandidateCounts
  stunUrls: string[]
  stateHistory: ProbeState[]
  errors: string[]
  pingRtts: number[]
  pongCount: number
  gatheringPromise: Promise<boolean>
  gatheringResolve(value: boolean): void
  synthetic?: { stream: MediaStream; timer: ReturnType<typeof setInterval> }
}
