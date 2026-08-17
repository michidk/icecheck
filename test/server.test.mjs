import { spawn } from 'node:child_process';
import net from 'node:net';
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIceConfiguration } from '../server/diagnostic-runtime.ts';
import {
  MANUAL_PROTOCOL_VERSION,
  decodeSignalEnvelope,
  encodeSignalEnvelope,
} from '../src/modules/icecheck/lib/manual-codec.ts';

let app;
let baseUrl;

const getAvailablePort = () => new Promise((resolve, reject) => {
  const probe = net.createServer();
  probe.once('error', reject);
  probe.listen(0, '127.0.0.1', () => {
    const { port } = probe.address();
    probe.close(() => resolve(port));
  });
});

const waitForOutput = (stream, expected) => new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error(`Timed out waiting for: ${expected}`)), 5_000);
  stream.on('data', (chunk) => {
    if (!chunk.toString().includes(expected)) return;
    clearTimeout(timeout);
    resolve();
  });
});

before(async () => {
  const port = await getAvailablePort();
  baseUrl = `http://127.0.0.1:${port}`;
  app = spawn(process.execPath, ['.output/server/index.mjs'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, NODE_ENV: 'production', PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForOutput(app.stdout, 'Listening on:');
});

after(() => app?.kill('SIGTERM'));

test('serves the single-page diagnostic UI and ICE configuration', async () => {
  const [healthResponse, configResponse, faviconResponse, homeResponse] = await Promise.all([
    fetch(`${baseUrl}/health`),
    fetch(`${baseUrl}/config`),
    fetch(`${baseUrl}/favicon.svg`),
    fetch(`${baseUrl}/`),
  ]);
  const health = await healthResponse.json();
  const config = await configResponse.json();
  const home = await homeResponse.text();

  assert.deepEqual(health, { ok: true });
  assert.deepEqual(config, { stunServers: [{
    urls: ['stun:main.lohr.dev:3478', 'stun:stun.l.google.com:19302'],
  }] });
  assert.equal(configResponse.headers.get('cache-control'), 'no-store');
  for (const response of [healthResponse, configResponse, faviconResponse, homeResponse]) {
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('x-frame-options'), 'DENY');
    assert.equal(response.headers.get('permissions-policy'), 'camera=(), microphone=(), display-capture=()');
  }
  assert.equal(faviconResponse.status, 200);
  assert.match(faviconResponse.headers.get('content-type'), /image\/svg\+xml/);
  assert.deepEqual(
    buildIceConfiguration({
      STUN_URLS: 'turn:relay.invalid:3478, stun:main.lohr.dev:3478, stun:stun.l.google.com:19302',
    }),
    { stunServers: [{ urls: ['stun:main.lohr.dev:3478', 'stun:stun.l.google.com:19302'] }] },
  );
  assert.equal(homeResponse.status, 200);
  assert.match(home, /Find where a peer connection fails/);
  assert.match(home, /Your connection data stays with you/);
  assert.match(home, /GitHub ↗/);
  assert.match(home, /Start or answer a connection/);
  assert.match(home, /No connection tested yet/);
  assert.match(home, /STUN discovery/);
  assert.match(home, /STUN server/);
  assert.doesNotMatch(home, /signaling_websocket/);
});

test('round-trips and validates base64url signaling envelopes', () => {
  const envelope = {
    version: MANUAL_PROTOCOL_VERSION,
    kind: 'offer',
    sessionId: 'session-12345678',
    strategyId: 'stun',
    createdAt: '2026-08-15T00:00:00.000Z',
    iceComplete: true,
    description: {
      type: 'offer',
      sdp: 'v=0\r\na=ice-ufrag:abc123\r\na=candidate:1 1 UDP 1 192.0.2.1 5000 typ srflx\r\n',
    },
  };

  const encoded = encodeSignalEnvelope(envelope);
  assert.match(encoded, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(decodeSignalEnvelope(`\n${encoded}\n`), envelope);
  assert.throws(() => decodeSignalEnvelope('not+base64'), /base64url/);
  assert.throws(() => encodeSignalEnvelope({ ...envelope, version: 99 }), /Unsupported/);
  assert.throws(() => encodeSignalEnvelope({
    ...envelope,
    kind: 'answer',
    description: { ...envelope.description, type: 'offer' },
  }), /matching RTC session description/);
});
