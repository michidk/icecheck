import type { CandidateCounts, CandidateKind } from './diagnostic-types.ts'

export function emptyCandidateCounts(): CandidateCounts {
  return { host: 0, srflx: 0, prflx: 0, relay: 0, unknown: 0 }
}

export function countCandidate(
  counts: CandidateCounts,
  candidate: RTCIceCandidate | RTCIceCandidateInit,
) {
  const type = (
    ('type' in candidate && candidate.type)
    || candidate.candidate?.match(/\btyp\s+(host|srflx|prflx|relay)\b/u)?.[1]
    || 'unknown'
  ) as CandidateKind
  counts[type] = (counts[type] || 0) + 1
}

export function countCandidatesInSdp(sdp = ''): CandidateCounts {
  const counts = emptyCandidateCounts()
  for (const line of sdp.split(/\r?\n/u)) {
    if (!line.startsWith('a=candidate:')) continue
    const type = (line.match(/\btyp\s+(host|srflx|prflx|relay)\b/u)?.[1] || 'unknown') as CandidateKind
    counts[type] += 1
  }
  return counts
}
