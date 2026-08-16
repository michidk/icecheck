# icecheck

`icecheck` is a small TanStack Start SPA for two-browser WebRTC diagnostics. It isolates signaling, ICE candidate gathering, connectivity checks, data channels, and media transport so developers can see which layer failed.

The browser implementation uses the native Web APIs directly:

- `RTCPeerConnection`
- `RTCDataChannel`
- `MediaStream`
- `HTMLCanvasElement.captureStream()`
- `RTCPeerConnection.getStats()`

It does not use PeerJS, simple-peer, Socket.IO, or another WebRTC abstraction. TanStack Start supplies the React application shell and file-based routing; browser WebRTC behavior still uses the native APIs directly. The server-assisted mode uses a small `ws` relay only to exchange SDP and trickled ICE candidates. Manual mode does not send signaling through the server.

The Start plugin is configured with `spa.enabled: true`. Initial requests receive a prerendered shell, and the matching diagnostic route renders in the browser. No route component or WebRTC browser API executes during server rendering.

## Start the tool

```sh
npm install
npm run dev
```

The Vite development server defaults to `http://localhost:4173`. To test across devices, bind it to a reachable interface:

```sh
PORT=4173 HOST=0.0.0.0 npm run dev
```

To exercise the production SPA server:

```sh
npm run build
PORT=4173 HOST=0.0.0.0 npm start
```

The production Node process serves `dist/client/_shell.html`, static assets, `/config`, `/health`, and the `/signal` WebSocket on one origin.

For phone testing, open the tool through an HTTPS or LAN-reachable origin before creating a room. A URL containing `localhost` refers to the device opening it, so it cannot be copied from a computer to a phone.

## Test modes

### Server-assisted matrix

1. Open `/session` on browser A, or choose **Assisted room** from `/`.
2. Select **Create room**.
3. Open the generated peer URL on browser B.
4. Select **Run all** on browser A.
5. Inspect the selected candidate pair, state history, data RTT, received media bytes, errors, and raw JSON.

The WebSocket carries only signaling and diagnostic coordination. The data-channel and generated-video probes travel over the negotiated WebRTC path.

### Manual base64 signaling

Use this mode to prove that WebRTC works independently of the WebSocket signaling implementation.

Open `/manual` on both browsers, or choose **Manual copy/paste** from `/`. This route does not create a WebSocket. The previous `/?manual=1` address redirects to `/manual` for compatibility.

1. On browser A, select an ICE strategy and select **Create offer**.
2. Wait for ICE gathering to complete. Copy `local_payload` to browser B.
3. On browser B, paste it into `remote_payload` and select **Process remote payload**.
4. Browser B recognizes the offer, creates an answer, waits for ICE gathering, and places the answer in its `local_payload`.
5. Copy browser B's payload back to browser A.
6. On browser A, paste the answer into `remote_payload` and select **Process remote payload**.
7. Watch `connection`, `ice`, `data_channel`, `video`, and `selected_pair` on both browsers.

Manual mode uses non-trickle ICE. Each browser waits up to 15 seconds for candidate gathering before encoding the local SDP. This means the copied offer and answer already contain the candidates and no later candidate messages are needed.

See [Manual signaling protocol](docs/manual-signaling.md) for the envelope schema, state machine, decoding instructions, and security notes.

## ICE strategies

| Strategy | `iceServers` | `iceTransportPolicy` | What it proves |
| --- | --- | --- | --- |
| LAN only | Empty | `all` | A host-to-host path is reachable, commonly on the same LAN |
| STUN only | Configured STUN servers | `all` | A direct host or server-reflexive path works without media relay |

The STUN-only strategy permits both `host` and `srflx` candidates. Inspect the selected pair to determine whether the configured STUN server contributed the winning `srflx` candidate. No TURN server or relay strategy is configured.

## Reported data

Every probe records:

- `connectionState`, `iceConnectionState`, `iceGatheringState`, and `signalingState`
- Counts of local and remote `host`, `srflx`, `prflx`, and unexpected `relay` candidates
- Selected local and remote candidate type, protocol, address, port, and network type when exposed by the browser
- Candidate-pair RTT and available outgoing bitrate when exposed
- Data-channel open state and application-level ping RTT
- Inbound/outbound video bytes and encoded/decoded frames
- ICE candidate errors
- A chronological state-transition history
- Browser user agent and test timestamps

Browsers may redact candidate addresses or omit some `getStats()` fields for privacy. Missing address data is not itself a connectivity failure.

## Interpreting results

| Observation | Likely conclusion |
| --- | --- |
| LAN passes | The browsers have a mutually reachable host-candidate path |
| STUN passes | A direct host or server-reflexive path works for this device pair |
| LAN passes and STUN fails | A local path works, but public NAT traversal is blocked or unavailable |
| LAN and STUN both fail | No direct path was found; there is intentionally no relay fallback |
| ICE connects but data fails | Inspect data-channel negotiation and browser errors |
| Data passes but video has zero inbound bytes | Inspect codec/media negotiation and autoplay/decode behavior |
| Server-assisted fails but manual passes | The WebSocket signaling path or signaling protocol is the likely fault |
| Both modes fail with the same strategy | The issue is likely ICE/network configuration rather than signaling |

See [Architecture and diagnostics](docs/architecture.md) for the complete flow and failure boundaries.

## Server configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `4173` in dev; `3100` in production | HTTP and WebSocket port |
| `HOST` | `0.0.0.0` | Network interface to bind |
| `BASE_PATH` | _(empty)_ | Optional URL prefix, such as `/tools/icecheck` |
| `ALLOWED_HOSTS` | _(empty)_ | Comma-separated hostnames accepted by the Vite development server |
| `STUN_URLS` | `stun:main.lohr.dev:3478` | Comma-separated STUN URLs; non-STUN entries are ignored |

The tester is intentionally STUN-only. Connections that require a media relay will fail, which makes that limitation visible instead of silently falling back to TURN.

## Framework and repository map

```text
tester/
├── vite.config.ts             TanStack Start SPA mode and dev signaling plugin
├── tsconfig.json              Strict React/Start TypeScript configuration
├── server.mjs                 Production SPA and signaling server
├── server/
│   └── diagnostic-runtime.mjs Shared /config, /health, and /signal runtime
├── src/
│   ├── router.tsx             Fresh TanStack Router factory
│   ├── routeTree.gen.ts       Generated file-route tree
│   ├── routes/
│   │   ├── __root.tsx         Document shell, metadata, and global CSS
│   │   ├── (home)/            Mode chooser and route-local UI
│   │   │   ├── index.tsx
│   │   │   └── -components/home-page.tsx
│   │   ├── session/index.tsx  Assisted room entry route
│   │   ├── manual/index.tsx   Manual signaling entry route
│   │   └── room/$roomCode/
│   │       └── index.tsx      Shareable room route
│   ├── modules/icecheck/
│   │   ├── components/
│   │   │   ├── assisted-diagnostic.tsx
│   │   │   ├── manual-diagnostic.tsx
│   │   │   └── runtime-panel.tsx
│   │   ├── hooks/
│   │   │   └── use-icecheck-client.ts
│   │   └── lib/
│   │       ├── icecheck-client.client.js
│   │       └── manual-codec.js
│   └── styles/app.css         Compact responsive styling
├── docs/
│   ├── architecture.md        Components, probe lifecycle, and diagnostics
│   └── manual-signaling.md    Copy/paste protocol specification
└── test/server.test.mjs       HTTP, WebSocket relay, and codec tests
```

## Development checks

```sh
npm test
npm run typecheck
npm run build
node --check server.mjs
node --check server/diagnostic-runtime.mjs
node --check src/modules/icecheck/lib/icecheck-client.client.js
node --check src/modules/icecheck/lib/manual-codec.js
npm audit --omit=dev
```

## Security and privacy

- WebRTC encrypts data-channel and media traffic in transit.
- Signaling confidentiality is separate from WebRTC transport encryption.
- Base64url is an encoding, not encryption.
- SDP can expose IP addresses, ephemeral ICE credentials, codecs, fingerprints, and other browser/network metadata.
- Manual payloads should be shared only with the intended peer and discarded after the session.
- Room codes are diagnostic conveniences, not authentication or authorization.

## License

MIT
