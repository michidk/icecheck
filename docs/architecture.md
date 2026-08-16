# Architecture and diagnostics

## Goals

icecheck separates four concerns that are often conflated during WebRTC debugging:

1. Can both browsers load the application and ICE configuration?
2. Can they exchange signaling messages?
3. Can ICE construct a working network path?
4. Can data and media travel over that path?

The implementation creates a new `RTCPeerConnection` for every strategy so candidates and state from an earlier test cannot contaminate the next result.

## Framework boundary

TanStack Start owns the document shell, browser bootstrap, and file-based routes. SPA mode is enabled in [`vite.config.ts`](../vite.config.ts), so Start prerenders only `_shell.html`; the actual diagnostic page renders on the client.

There are four user-facing routes with three distinct jobs:

- `/` is a mode chooser. It explains the difference between assisted and manual signaling before any connection is started.
- `/session` creates or joins an assisted room and runs the two-strategy matrix.
- `/room/$roomCode` opens a shareable assisted-room URL on the second browser.
- `/manual` runs the copy/paste offer-answer workflow without opening a WebSocket.

The assisted and manual routes import the reusable `src/modules/icecheck` feature. The route files contain only URL ownership; shared runtime UI and the native WebRTC controller have one implementation. The chooser UI belongs only to `/`, so it remains colocated under `routes/(home)/-components`.

The controller is named `icecheck-client.client.js` and is loaded through `createClientOnlyFn()`. This keeps `window`, canvas, WebSocket, and WebRTC code out of the server bundle used to prerender the SPA shell.

During development, Vite owns the HTTP server. A small Vite plugin attaches the shared diagnostic runtime to that server. In production, [`server.mjs`](../server.mjs) serves the generated SPA shell and attaches the same runtime. Both environments therefore expose identical `/config`, `/health`, and `/signal` behavior.

## Components

```text
Browser A                                  Browser B
---------                                  ---------
native RTCPeerConnection                   native RTCPeerConnection
data-channel ping sender                   data-channel echo handler
generated canvas video                     hidden video receiver
getStats sampler                           getStats sampler
       |                                          |
       +------ WebSocket or copied SDP -----------+
                          |
                 diagnostic runtime
          (Vite dev or Node production server)
```

The application server has three responsibilities:

- Serve static files.
- Return public ICE configuration from `/config`.
- Relay allowlisted signaling messages over `/signal` for the server-assisted mode.

It does not terminate WebRTC, inspect media, relay media, or forward data-channel messages. TanStack Start and React do not wrap `RTCPeerConnection`; the feature controller calls the browser APIs directly.

## Server-assisted signaling protocol

The server accepts one host and one guest per room. It forwards only these message types:

- `signal-ping` and `signal-pong`
- `probe-start` and `probe-ready`
- `probe-description`
- `probe-candidate`
- `probe-finish` and `probe-result`

Probe sequence:

```text
host                    server                    guest
 | probe-start            |                         |
 |----------------------->|------------------------>|
 |                        |            create RTCPeerConnection
 | probe-ready            |                         |
 |<-----------------------|<------------------------|
 | create offer           |                         |
 | SDP offer              |                         |
 |----------------------->|------------------------>|
 | ICE candidates         |                         |
 |<---------------------->|<----------------------->|
 | SDP answer             |                         |
 |<-----------------------|<------------------------|
 |                                                   |
 |<============== native WebRTC path ===============>|
 |                                                   |
 | probe-finish           |                         |
 |----------------------->|------------------------>|
 | probe-result           |                         |
 |<-----------------------|<------------------------|
```

Candidates are trickled as they are discovered. Each automated probe runs for seven seconds after the offer is created, then both sides collect final statistics.

## Manual signaling

Manual mode replaces every message in the middle column with two copied base64url values. It waits for gathering and embeds candidates in SDP instead of trickling them.

Loading `/manual` suppresses WebSocket creation entirely. The page still fetches `/config` because both browsers need the same STUN configuration. The legacy `/?manual=1` URL redirects to `/manual`.

See [Manual signaling protocol](manual-signaling.md).

## Data-channel probe

The offerer creates an ordered data channel named `diagnostic`. After it opens:

1. The offerer sends three JSON ping messages, 250 ms apart.
2. Each message contains a sequence number and the offerer's `performance.now()` timestamp.
3. The answerer echoes the timestamp unchanged.
4. The offerer measures application-level round-trip time using its own monotonic clock.

This confirms more than ICE state alone. It proves that DTLS, SCTP, data-channel negotiation, and bidirectional application data work.

## Media probe

The offerer creates a 320x180 canvas animation and captures it at 10 frames per second. This avoids camera and screen-capture permissions while exercising a real video sender.

The answerer reports media success only when at least one of these is true:

- The video track becomes unmuted.
- `requestVideoFrameCallback()` observes a decoded frame.
- Inbound RTP reports non-zero `bytesReceived` or `framesDecoded`.

The report also includes outbound video bytes and encoded frame counts when the browser exposes them.

## Candidate types

| Type | Meaning |
| --- | --- |
| `host` | An interface address or browser-generated mDNS host name |
| `srflx` | A server-reflexive address learned through STUN |
| `prflx` | A peer-reflexive address discovered during connectivity checks |
| `relay` | A relayed address; not expected because this deployment has no TURN configuration |

Candidate gathering is not candidate selection. A test can gather an `srflx` candidate and still select a host pair. Use `selectedPair`, not candidate counts, to determine the path that carried traffic.

## Selected-pair discovery

icecheck reads `RTCPeerConnection.getStats()` and first checks the transport report's `selectedCandidatePairId`. As a compatibility fallback, it finds a nominated or selected candidate-pair report in the `succeeded` state.

It then resolves `localCandidateId` and `remoteCandidateId` and records fields browsers commonly expose:

- `candidateType`
- `protocol`
- `address` or `ip`
- `port`
- `networkType`
- `currentRoundTripTime`
- `availableOutgoingBitrate`

Browser privacy protections can redact addresses and network types. The connection-state and candidate-type fields remain the more portable signals.

## Failure boundaries

```text
page/config failure
  -> HTTP, HTTPS, origin, or deployment

WebSocket failure
  -> reverse-proxy upgrade handling or signaling server

offer/answer failure
  -> signaling ordering, malformed SDP, or browser compatibility

no srflx candidate
  -> STUN DNS/reachability or NAT behavior

no srflx candidate
  -> main.lohr.dev DNS, UDP/3478 reachability, or NAT behavior

ICE failed
  -> no mutually reachable direct candidate pair; no relay is configured

ICE connected, data closed
  -> DTLS/SCTP/data-channel negotiation

data open, video zero bytes
  -> RTP, codec, sender, receiver, or decode behavior
```

## Deployment requirements

- Bind the Node server to a reachable interface such as `0.0.0.0`.
- Use HTTPS for normal browser security-context behavior.
- Forward WebSocket upgrades for `/signal` when using server-assisted mode.
- The deployment is intentionally STUN-only, so both browsers must have a mutually reachable direct ICE path.
- A reverse proxy for the web app does not relay WebRTC media.

Manual-only mode does not require WebSocket forwarding, but it still requires both browsers to load the application and `/config`.

## Source map

- [`vite.config.ts`](../vite.config.ts): TanStack Start SPA configuration and development runtime attachment
- [`server.mjs`](../server.mjs): production static SPA host
- [`server/diagnostic-runtime.mjs`](../server/diagnostic-runtime.mjs): ICE configuration, rooms, and WebSocket forwarding shared by dev and production
- [`src/router.tsx`](../src/router.tsx): TanStack Router factory
- [`src/routes`](../src/routes): URL and document-shell ownership
- [`src/routes/(home)/-components/home-page.tsx`](<../src/routes/(home)/-components/home-page.tsx>): mode chooser used only by the root route
- [`src/modules/icecheck/components/assisted-diagnostic.tsx`](../src/modules/icecheck/components/assisted-diagnostic.tsx): assisted room journey shared by `/session` and `/room/$roomCode`
- [`src/modules/icecheck/components/manual-diagnostic.tsx`](../src/modules/icecheck/components/manual-diagnostic.tsx): manual copy/paste journey
- [`src/modules/icecheck/lib/icecheck-client.client.js`](../src/modules/icecheck/lib/icecheck-client.client.js): browser-only probe lifecycle, signaling modes, media/data tests, and statistics
- [`src/modules/icecheck/lib/manual-codec.js`](../src/modules/icecheck/lib/manual-codec.js): versioned envelope encoding and strict structural validation
- [`test/server.test.mjs`](../test/server.test.mjs): server, signaling relay, and envelope codec tests
