# Manual signaling protocol

This document specifies icecheck's copy/paste signaling workflow. It is intended to be readable enough to reproduce with another implementation.

## Purpose

WebRTC does not define a signaling transport. A WebSocket, HTTP endpoint, QR code, terminal, email, or clipboard can all carry the same offer and answer.

The copy/paste workflow lets developers answer this question:

> Can these two browsers establish the selected WebRTC path when the SDP is exchanged correctly by hand?

Open the icecheck root page on both browsers.

## Browser APIs used

The diagnostic uses only native browser APIs:

```js
const pc = new RTCPeerConnection(rtcConfiguration)
const channel = pc.createDataChannel('diagnostic')

await pc.setLocalDescription(await pc.createOffer())
// Wait for pc.iceGatheringState === 'complete'.

await pc.setRemoteDescription(remoteAnswer)
```

The answering browser performs the inverse operation:

```js
await pc.setRemoteDescription(remoteOffer)
await pc.setLocalDescription(await pc.createAnswer())
// Wait for pc.iceGatheringState === 'complete'.
```

## Why non-trickle ICE is required

WebRTC applications commonly send the initial SDP immediately and then send each ICE candidate as it is discovered. This is called trickle ICE.

Clipboard signaling has no persistent channel for later candidates. icecheck therefore waits until ICE gathering completes before copying `pc.localDescription`. At that point, the browser has inserted gathered candidates into the SDP.

The tool waits up to 15 seconds. If gathering times out, it still creates a payload with the candidates gathered so far and marks `iceComplete` as `false`.

## Operator state machine

```text
Browser A                              Browser B
---------                              ---------
select strategy
create RTCPeerConnection
create data channel + video track
createOffer()
setLocalDescription(offer)
wait for ICE gathering
encode and copy OFFER  ------------->  decode OFFER
                                       create RTCPeerConnection
                                       setRemoteDescription(offer)
                                       createAnswer()
                                       setLocalDescription(answer)
                                       wait for ICE gathering
apply decoded ANSWER   <-------------  encode and copy ANSWER
setRemoteDescription(answer)

                 ICE connectivity checks
                 DTLS handshake
                 data channel opens
                 generated video flows
```

The original offerer sends three application-level pings after the data channel opens. The answerer echoes each ping. Both browsers sample `RTCPeerConnection.getStats()` once per second.

## Envelope format

The copied string is unpadded base64url containing UTF-8 JSON:

```text
base64url(UTF8(JSON.stringify(envelope)))
```

Version 1 envelope:

```json
{
  "version": 1,
  "kind": "offer",
  "sessionId": "94c3a849-53ea-46bd-939d-13c57d81a295",
  "strategyId": "stun",
  "createdAt": "2026-08-15T12:00:00.000Z",
  "iceComplete": true,
  "description": {
    "type": "offer",
    "sdp": "v=0\r\n..."
  }
}
```

| Field | Type | Meaning |
| --- | --- | --- |
| `version` | integer | Envelope schema version. Currently `1` |
| `kind` | `offer` or `answer` | Expected RTC session-description type |
| `sessionId` | string | Correlates the answer to the exact offer |
| `strategyId` | `lan` or `stun` | Selects the receiving browser's ICE configuration |
| `createdAt` | ISO timestamp | Human-readable diagnostic timestamp |
| `iceComplete` | boolean | Whether gathering completed before encoding |
| `description.type` | `offer` or `answer` | Passed to `setRemoteDescription()` |
| `description.sdp` | string | Complete Session Description Protocol text |

The answer must have the same `sessionId` and `strategyId` as the offer. icecheck rejects mismatches rather than applying an answer to the wrong peer connection.

## Decode a payload manually

Base64url differs from ordinary base64 by replacing `+` with `-`, replacing `/` with `_`, and omitting trailing `=` padding.

In a browser console:

```js
function decodeIcecheckPayload(value) {
  const compact = value.replace(/\s+/g, '')
  const padded = compact.replaceAll('-', '+').replaceAll('_', '/')
    + '='.repeat((4 - compact.length % 4) % 4)
  const bytes = Uint8Array.from(atob(padded), c => c.charCodeAt(0))
  return JSON.parse(new TextDecoder().decode(bytes))
}
```

This is useful when verifying that SDP candidates were embedded before moving the payload to the other browser.

## Validation rules

[`src/modules/icecheck/lib/manual-codec.ts`](../src/modules/icecheck/lib/manual-codec.ts) rejects payloads when:

- The value is not valid base64url.
- The decoded value is not JSON.
- The envelope version is unsupported.
- The kind is not `offer` or `answer`.
- The strategy is unknown.
- The session identifier is missing or unreasonable.
- `description.type` does not match `kind`.
- SDP does not start with `v=0`.
- The encoded value or SDP exceeds the defensive size limit.

Validation checks structure, not trust. The remote SDP is still untrusted input interpreted by the browser's WebRTC implementation.

## Candidate behavior per strategy

### LAN only

`iceServers` is empty and `iceTransportPolicy` is `all`. The payload normally contains host candidates only. Browsers may use mDNS names rather than literal local IP addresses.

### STUN-assisted

The configured STUN service can add server-reflexive (`srflx`) candidates. Host candidates remain permitted, so this is not a STUN-only transport policy. Inspect the selected candidate pair to see which type actually won.

No TURN server is configured. Manual tests therefore succeed only when the browsers can form a direct host or server-reflexive path.

## Security properties

Base64url provides no secrecy, integrity, authentication, or peer identity.

An SDP payload can contain:

- Local, public, or mDNS candidate addresses
- Temporary ICE username fragments and passwords
- DTLS certificate fingerprints
- Codec names and capabilities
- Media identifiers and browser-specific attributes

The DTLS fingerprint helps secure the eventual WebRTC transport, but the manual exchange itself is not authenticated by icecheck. Exchange payloads over a trusted channel if peer identity matters.

Do not paste manual payloads into public issue trackers without reviewing or redacting them.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Offer has no candidates | Wait for gathering or inspect `icecandidateerror` entries |
| STUN offer has no `srflx` candidate | Verify `main.lohr.dev`, UDP port 3478, DNS, and firewall reachability |
| Answer is rejected | Confirm it belongs to the current `sessionId` and strategy |
| ICE remains `checking` | Compare candidate types and verify that at least one pair is mutually reachable |
| ICE becomes `failed` | The exchanged candidates produced no working pair |
| ICE connects but data stays closed | Inspect SCTP/data-channel state and browser console errors |
| Video stays negotiated with zero bytes | Inspect inbound/outbound RTP stats and codec support |
