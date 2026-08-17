import type {
  CandidatePair,
  CandidateStats,
  CandidateSummary,
  MediaStats,
  Probe,
  ProbeResult,
} from './diagnostic-types.ts'

export async function collectProbeResult(probe: Probe, userAgent = navigator.userAgent): Promise<ProbeResult> {
  const selectedPair = await getSelectedPair(probe.pc)
  const mediaStats = await getMediaStats(probe.pc)
  probe.videoReceived ||= mediaStats.inboundVideoBytes > 0 || mediaStats.framesDecoded > 0
  return {
    side: probe.initiator ? 'offerer' : 'answerer',
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
    userAgent,
  }
}

async function getMediaStats(pc: RTCPeerConnection): Promise<MediaStats> {
  const result: MediaStats = { inboundVideoBytes: 0, outboundVideoBytes: 0, framesDecoded: 0, framesEncoded: 0 }
  try {
    const stats = await pc.getStats()
    for (const stat of stats.values()) {
      const kind = stat.kind || stat.mediaType
      if (kind !== 'video') continue
      if (stat.type === 'inbound-rtp' && !stat.isRemote) {
        result.inboundVideoBytes += stat.bytesReceived || 0
        result.framesDecoded += stat.framesDecoded || 0
      } else if (stat.type === 'outbound-rtp' && !stat.isRemote) {
        result.outboundVideoBytes += stat.bytesSent || 0
        result.framesEncoded += stat.framesEncoded || 0
      }
    }
  } catch {}
  return result
}

async function getSelectedPair(pc: RTCPeerConnection): Promise<CandidatePair | undefined> {
  try {
    const stats = await pc.getStats()
    let pair
    for (const stat of stats.values()) {
      if (stat.type === 'transport' && stat.selectedCandidatePairId) pair = stats.get(stat.selectedCandidatePairId)
    }
    if (!pair) {
      for (const stat of stats.values()) {
        if (stat.type === 'candidate-pair' && stat.state === 'succeeded' && (stat.nominated || stat.selected)) pair = stat
      }
    }
    if (!pair) return undefined
    return {
      local: summarizeCandidate(stats.get(pair.localCandidateId)),
      remote: summarizeCandidate(stats.get(pair.remoteCandidateId)),
      currentRoundTripTimeMs: Number.isFinite(pair.currentRoundTripTime)
        ? Math.round(pair.currentRoundTripTime * 1000)
        : undefined,
      availableOutgoingBitrate: pair.availableOutgoingBitrate,
    }
  } catch (error: unknown) {
    return { error: error instanceof Error && error.message ? error.message : 'Could not read the selected candidate pair.' }
  }
}

function summarizeCandidate(candidate: CandidateStats | undefined): CandidateSummary | undefined {
  if (!candidate) return undefined
  return {
    type: candidate.candidateType,
    protocol: candidate.protocol,
    address: candidate.address || candidate.ip,
    port: candidate.port,
    url: candidate.url,
    networkType: candidate.networkType,
    relayProtocol: candidate.relayProtocol,
  }
}
