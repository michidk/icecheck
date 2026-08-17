# Architecture

icecheck is a stateless TanStack Start SPA with a browser-only WebRTC diagnostic module. The server delivers the application and public STUN configuration; users transfer session descriptions directly between two browsers.

## Boundaries

```text
routes                    icecheck feature                  platform adapters
------                    ----------------                  -----------------
/            -----------> public diagnostic component
                           lifecycle hook
                           manual controller  ----------->  native browser WebRTC
                           codec + reports

browser GET /config  ------------------------------------>  Nitro or Vite HTTP adapter
browser GET /health  ------------------------------------>  Nitro or Vite HTTP adapter
```

- Route files own URLs, metadata, and page composition.
- `src/modules/icecheck/components` is the reusable diagnostic feature's public UI boundary.
- `hooks/use-manual-diagnostic.ts` loads browser code only after hydration and disposes it on route unmount.
- `lib/manual-client.client.ts` coordinates the UI state machine.
- `lib/probe-session.client.ts` owns the lifetime of `RTCPeerConnection`, data channels, tracks, and timers.
- `lib/probe-result.client.ts` translates browser stats into report types.
- `lib/manual-codec.ts` owns the versioned copy/paste envelope and defensive validation.
- Server code does not import browser feature internals.

The architecture checker enforces the route-to-feature and server-to-client import boundaries. Route pages use folder-based `index.tsx` files, route-private code uses the `-` ignore prefix, and generated `src/routeTree.gen.ts` is not edited by hand.

## Routes and server surface

The application exposes one page: `/` introduces and runs the interactive two-browser exchange.

The server exposes two JSON endpoints:

- `/config` returns allowlisted public STUN URLs.
- `/health` returns `{ "ok": true }`.

There is no WebSocket endpoint, room registry, peer registry, or cross-request session state. This makes the deployment safe to distribute across short-lived function instances.

## Negotiation flow

icecheck uses non-trickle ICE because the clipboard cannot carry candidates discovered after an offer or answer has been transferred.

```text
Browser A                                      Browser B
---------                                      ---------
create peer connection
create data channel and generated video
create and set local offer
wait for ICE gathering
copy complete offer  ------------------------> validate and set remote offer
                                                create and set local answer
                                                wait for ICE gathering
apply complete answer <----------------------- copy complete answer

              ICE checks and DTLS handshake
              data channel and video flow peer-to-peer
```

Gathering waits for `iceGatheringState === "complete"` with a 15-second limit. A timed-out payload includes candidates gathered so far and records `iceComplete: false`. The UI presents the next role-specific handoff action and derives a verdict from the connection, data-channel, and media results.

The answer is accepted only when its session identifier and ICE strategy match the current offer. Resetting or leaving the route closes the peer connection, data channel, generated media tracks, polling interval, event handlers, and pending work.

## ICE strategies

| Strategy | `iceServers` | Expected candidates |
| --- | --- | --- |
| LAN only | empty | host, possibly peer-reflexive |
| STUN-assisted | configured public STUN URLs | host, server-reflexive, possibly peer-reflexive |

No TURN server is configured. A restrictive NAT or firewall may therefore prevent either strategy from connecting.

## Diagnostic data

Each browser records:

- connection, ICE, gathering, and SDP signaling states
- local and remote candidate counts by type
- STUN discovery success, configured and browser-reported responding servers, and whether the selected path uses a server-reflexive candidate
- selected local and remote candidate details
- current candidate-pair round-trip time when available
- data-channel state and ping round-trip samples
- inbound and outbound video byte and packet counts
- state history and browser errors

Reports stay in the browser. The only application-server request made by the diagnostic controller is the configuration fetch.

## Deployment properties

The Nitro production output and Vite development adapter expose the same `/config` and `/health` contracts. Nitro middleware and the development adapter apply the same security headers; Vercel repeats those headers at the deployment edge. Vercel can create, stop, or route requests among function instances without invalidating a diagnostic because all peer state lives in the two browser tabs.

Production should provide HTTPS and allow outbound access to the configured STUN endpoints. Both devices must be able to reach the deployed page, but they do not need to reach the same application instance.

## Testing

- Contract tests cover candidate classification.
- Codec tests cover round-trip encoding, version checks, correlation fields, and defensive limits.
- Built-server tests verify the diagnostic page and stateless HTTP endpoints.
- Browser tests verify readiness, configuration and payload failures, a complete two-page WebRTC exchange, and peer cleanup after reset.

See [Manual signaling protocol](manual-signaling.md) for the exact envelope schema and operator state machine.
