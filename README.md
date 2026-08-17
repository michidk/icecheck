# icecheck — WebRTC path debugger

`icecheck` is a developer tool for testing whether two browsers can establish a direct WebRTC connection. It gathers ICE candidates, opens a data channel, sends synthetic video, and exposes the selected candidate pair and connection statistics.

The offer and answer are exchanged by copy and paste. There are no rooms, WebSockets, or process-local connection registries, so the application is compatible with stateless deployments such as Vercel Functions.

## What it tests

- Native `RTCPeerConnection` negotiation between two browsers
- LAN-only ICE with no configured ICE server
- STUN-assisted ICE using configured public STUN endpoints
- Host, peer-reflexive, and server-reflexive candidate discovery
- Selected candidate pair and round-trip time
- Ordered data-channel delivery with application-level pings
- Synthetic-video negotiation and received RTP statistics

No TURN server is configured, so icecheck does not test relayed connectivity or bandwidth.

## Run locally

Requirements: Node.js 24 and npm.

```bash
npm install
npm run dev
```

For a production build:

```bash
npm run build
npm start
```

The development server defaults to `http://localhost:4173`. Open `/manual` in two browsers or select **Open diagnostic** on the overview page.

## Diagnostic workflow

1. On browser A, select an ICE strategy and choose **Create offer**.
2. Copy A's outbound payload into **Offer or answer to apply** on browser B and choose **Apply inbound payload**.
3. Copy B's generated answer into the same field on browser A and apply it.
4. Inspect connection state, candidate counts, selected pair, data-channel state, video state, and the JSON report on both browsers.
5. Use **Start over** before starting another exchange.

Each base64url payload contains a complete session description. icecheck waits for non-trickle ICE gathering before encoding it, so no persistent signaling channel is needed. See [the manual signaling protocol](docs/manual-signaling.md) for the schema and state machine.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `STUN_URLS` | `stun:main.lohr.dev:3478,stun:stun.l.google.com:19302` | Comma-separated STUN URLs returned by `/config` |
| `BASE_PATH` | empty | Optional URL prefix |
| `HOST` | `0.0.0.0` | Development or legacy-server bind address |
| `PORT` | runtime-defined | Development or production port |
| `ALLOWED_HOSTS` | empty | Comma-separated extra Vite development hosts |

Only `stun:` and `stuns:` entries are accepted. TURN credentials are intentionally outside this tool's scope.

## Deployment

The generated Nitro server exposes only stateless HTTP behavior:

- the SPA routes `/` and `/manual`
- `GET /config` for public ICE configuration
- `GET /health` for readiness
- static assets

There is no application-managed connection between the two browsers. A deployment can scale horizontally or restart without losing a room or socket because none exists. The copied SDP is never sent to the icecheck server.

HTTPS is recommended for consistent browser security behavior. For phone testing, use a URL reachable by both devices; `localhost` always refers to the device opening it.

## Interpretation

| Observation | Likely meaning |
| --- | --- |
| LAN succeeds, STUN-assisted succeeds | The browsers found a direct path; inspect `selected_pair` to see which candidate type won |
| LAN fails, STUN-assisted succeeds | Server-reflexive discovery was needed |
| Both fail | Candidate pairs were not mutually reachable, or local policy/firewall/browser support blocked negotiation |
| ICE connects, data channel fails | Inspect SCTP/data-channel state and browser errors |
| Data works, video does not | Inspect RTP stats, codec support, and generated-track support |

Browser privacy protections may replace local addresses with mDNS names or redact details. Candidate types and connection states are more portable signals.

## Project structure

```text
server/
  diagnostic-runtime.ts       Shared /config and /health middleware
  routes/                     Nitro HTTP adapters
src/
  components/                 App-wide presentation
  modules/icecheck/
    components/               Diagnostic UI
    hooks/                    Client lifecycle adapter
    lib/                      Manual codec and native WebRTC implementation
  routes/
    (home)/                   Overview route and colocated home UI
    manual/                   Diagnostic route
test/
  browser/                    Browser lifecycle coverage
  contracts.test.mjs          Candidate-report contracts
  server.test.mjs             Built-server and codec integration coverage
```

The manual route imports the feature's public React component. Browser-only WebRTC code is dynamically loaded by the feature hook and disposed whenever the route unmounts. See [Architecture](docs/architecture.md) for the boundaries and negotiation flow, and [AGENTS.md](AGENTS.md) for contributor guidance.

## Verification

```bash
npm run verify
npm run test:e2e
```

`verify` runs ESLint, architecture checks, TypeScript, the production build, and Node integration tests.

The browser suite starts the development server automatically and expects Chromium to be installed (`npx playwright install chromium`). Set `E2E_BASE_URL` to run it against an existing deployment. Playwright output is kept under `.playwright/`.

## Security

Base64url is encoding, not encryption. SDP can expose network addresses, temporary ICE credentials, DTLS fingerprints, codecs, and browser metadata. Transfer payloads only through a channel appropriate for the peers involved, and review them before posting in public issues.

The eventual WebRTC transport is encrypted by the browser, but icecheck does not authenticate the person who supplied a copied payload.

## License

[MIT](LICENSE)
