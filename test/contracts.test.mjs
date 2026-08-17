import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  countCandidate,
  countCandidatesInSdp,
  emptyCandidateCounts,
} from '../src/modules/icecheck/lib/diagnostic-report.ts';

test('candidate counting recognizes every ICE candidate type', () => {
  const sdp = [
    'v=0',
    'a=candidate:1 1 UDP 1 host.local 5000 typ host',
    'a=candidate:2 1 UDP 1 192.0.2.10 5001 typ srflx',
    'a=candidate:3 1 UDP 1 198.51.100.10 5002 typ prflx',
    'a=candidate:4 1 UDP 1 203.0.113.10 5003 typ relay',
    'a=candidate:5 malformed',
  ].join('\r\n');

  assert.deepEqual(countCandidatesInSdp(sdp), {
    host: 1,
    srflx: 1,
    prflx: 1,
    relay: 1,
    unknown: 1,
  });
});

test('individual candidates are counted from browser fields or candidate text', () => {
  const counts = emptyCandidateCounts();
  countCandidate(counts, { candidate: 'candidate:1 1 UDP 1 192.0.2.10 5001 typ srflx' });
  countCandidate(counts, { candidate: 'candidate:2 1 UDP 1 host.local 5002 typ host' });
  countCandidate(counts, { candidate: '' });

  assert.deepEqual(counts, { host: 1, srflx: 1, prflx: 0, relay: 0, unknown: 1 });
});
