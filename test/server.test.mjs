import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import net from 'node:net';
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { buildIceConfiguration } from '../server/diagnostic-runtime.mjs';
import {
  MANUAL_PROTOCOL_VERSION,
  decodeSignalEnvelope,
  encodeSignalEnvelope,
} from '../src/modules/icecheck/lib/manual-codec.js';

let app;
let baseUrl;
let signalUrl;

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

class SignalingClient {
  constructor(url) {
    this.queue = [];
    this.waiters = [];
    this.socket = new WebSocket(url);
    this.socket.on('message', (raw) => {
      const message = JSON.parse(raw.toString());
      const index = this.waiters.findIndex(({ predicate }) => predicate(message));
      if (index >= 0) this.waiters.splice(index, 1)[0].resolve(message);
      else this.queue.push(message);
    });
  }

  async open() {
    if (this.socket.readyState === WebSocket.OPEN) return;
    await new Promise((resolve, reject) => {
      this.socket.once('open', resolve);
      this.socket.once('error', reject);
    });
  }

  next(type) {
    const predicate = (message) => message.type === type;
    const index = this.queue.findIndex(predicate);
    if (index >= 0) return Promise.resolve(this.queue.splice(index, 1)[0]);
    return new Promise((resolve, reject) => {
      const waiter = { predicate, resolve };
      this.waiters.push(waiter);
      setTimeout(() => {
        const waiterIndex = this.waiters.indexOf(waiter);
        if (waiterIndex >= 0) this.waiters.splice(waiterIndex, 1);
        reject(new Error(`Timed out waiting for ${type}`));
      }, 3_000).unref();
    });
  }

  send(message) {
    this.socket.send(JSON.stringify(message));
  }

  close() {
    this.socket.close();
  }
}

before(async () => {
  const port = await getAvailablePort();
  baseUrl = `http://127.0.0.1:${port}`;
  signalUrl = `ws://127.0.0.1:${port}/signal`;
  app = spawn(process.execPath, ['.output/server/index.mjs'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, NODE_ENV: 'production', PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForOutput(app.stdout, 'Listening on:');
});

after(() => app?.kill('SIGTERM'));

test('serves the diagnostic UI and ICE strategy configuration', async () => {
  const healthResponse = await fetch(`${baseUrl}/health`);
  const configResponse = await fetch(`${baseUrl}/config`);
  const faviconResponse = await fetch(`${baseUrl}/favicon.svg`);
  const [homeResponse, sessionResponse, manualResponse, roomResponse] = await Promise.all([
    fetch(`${baseUrl}/`),
    fetch(`${baseUrl}/session`),
    fetch(`${baseUrl}/manual`),
    fetch(`${baseUrl}/room/ABC123`),
  ]);
  const health = await healthResponse.json();
  const config = await configResponse.json();
  const page = await roomResponse.text();
  await Promise.all([homeResponse.text(), sessionResponse.text(), manualResponse.text()]);
  const home = await readFile(new URL('../src/routes/(home)/-components/home-page.tsx', import.meta.url), 'utf8');
  const assisted = await readFile(new URL('../src/modules/icecheck/components/assisted-diagnostic.tsx', import.meta.url), 'utf8');
  const manual = await readFile(new URL('../src/modules/icecheck/components/manual-diagnostic.tsx', import.meta.url), 'utf8');
  const client = await readFile(new URL('../src/modules/icecheck/lib/icecheck-client.client.js', import.meta.url), 'utf8');

  assert.equal(health.ok, true);
  assert.deepEqual(config, { stunServers: [{ urls: ['stun:main.lohr.dev:3478'] }] });
  assert.equal(configResponse.headers.get('cache-control'), 'no-store');
  assert.equal(faviconResponse.status, 200);
  assert.match(faviconResponse.headers.get('content-type'), /image\/svg\+xml/);
  assert.deepEqual(
    buildIceConfiguration({ STUN_URLS: 'turn:relay.invalid:3478, stun:main.lohr.dev:3478' }),
    { stunServers: [{ urls: ['stun:main.lohr.dev:3478'] }] },
  );
  assert.deepEqual(
    [homeResponse.status, sessionResponse.status, manualResponse.status, roomResponse.status],
    [200, 200, 200, 200],
  );
  assert.match(page, /<title>Join WebRTC diagnostic room · icecheck<\/title>/);
  assert.match(page, /Trace a native WebRTC connection/);
  assert.match(home, /Find where a peer connection fails/);
  assert.match(home, /connectivity diagnostic—not a bandwidth benchmark/);
  assert.match(home, /Start assisted test/);
  assert.match(home, /Open manual mode/);
  assert.match(assisted, /probe data channel and video do not pass through the application server/);
  assert.match(assisted, /Session JSON/);
  assert.doesNotMatch(assisted, /manual-local-payload/);
  assert.match(manual, /Test without a signaling server/);
  assert.match(manual, /base64url is not encryption/);
  assert.doesNotMatch(manual, /create-room/);
  assert.match(client, /No ICE server/);
  assert.match(client, /STUN configured/);
  assert.doesNotMatch(client, /TURN forced/);
  assert.doesNotMatch(client, /Automatic ICE/);
  assert.match(client, /APP_MODE === 'manual'/);
  assert.match(client, /else \{\s*connectSignaling\(\)/);
});

test('creates a two-device room and forwards diagnostic signaling', async () => {
  const host = new SignalingClient(signalUrl);
  const guest = new SignalingClient(signalUrl);
  await Promise.all([host.open(), guest.open()]);
  await Promise.all([host.next('hello'), guest.next('hello')]);

  host.send({ type: 'create-room' });
  const { roomCode } = await host.next('room-created');
  assert.match(roomCode, /^[A-Z2-9]{6}$/);

  guest.send({ type: 'join-room', roomCode });
  const [joined, peerJoined] = await Promise.all([guest.next('room-joined'), host.next('peer-joined')]);
  assert.equal(joined.roomCode, roomCode);
  assert.ok(peerJoined.peerId);

  host.send({ type: 'probe-start', testId: 'probe-1', strategyId: 'stun' });
  const forwarded = await guest.next('probe-start');
  assert.equal(forwarded.testId, 'probe-1');
  assert.equal(forwarded.strategyId, 'stun');
  assert.ok(forwarded.from);

  guest.send({ type: 'probe-ready', testId: 'probe-1' });
  assert.equal((await host.next('probe-ready')).testId, 'probe-1');

  host.close();
  guest.close();
});

test('round-trips and validates manual base64url signaling envelopes', () => {
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
