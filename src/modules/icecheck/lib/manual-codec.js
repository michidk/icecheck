/**
 * Manual signaling envelope format.
 *
 * The encoded value is base64url(JSON). It is deliberately easy to inspect
 * and transport, and deliberately does not claim to provide confidentiality.
 */
export const MANUAL_PROTOCOL_VERSION = 1;

const STRATEGY_IDS = new Set(['lan', 'stun']);
const DESCRIPTION_TYPES = new Set(['offer', 'answer']);
const MAX_ENCODED_LENGTH = 512_000;

export function encodeSignalEnvelope(envelope) {
  validateSignalEnvelope(envelope);
  const bytes = new TextEncoder().encode(JSON.stringify(envelope));
  let binary = '';
  for (let index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index]);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

export function decodeSignalEnvelope(encoded) {
  const compact = String(encoded || '').replace(/\s+/gu, '');
  if (!compact) throw new Error('Paste a manual signaling payload first.');
  if (compact.length > MAX_ENCODED_LENGTH) throw new Error('The signaling payload is too large.');
  if (!/^[A-Za-z0-9_-]+$/u.test(compact)) throw new Error('The payload is not valid base64url.');

  const padding = '='.repeat((4 - compact.length % 4) % 4);
  let binary;
  try {
    binary = atob(compact.replaceAll('-', '+').replaceAll('_', '/') + padding);
  } catch {
    throw new Error('The payload could not be decoded as base64url.');
  }

  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  let envelope;
  try {
    envelope = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error('The decoded payload is not valid JSON.');
  }
  validateSignalEnvelope(envelope);
  return envelope;
}

export function validateSignalEnvelope(envelope) {
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
    throw new Error('The signaling envelope must be an object.');
  }
  if (envelope.version !== MANUAL_PROTOCOL_VERSION) {
    throw new Error(`Unsupported signaling envelope version: ${envelope.version ?? 'missing'}.`);
  }
  if (!DESCRIPTION_TYPES.has(envelope.kind)) throw new Error('The envelope kind must be offer or answer.');
  if (!STRATEGY_IDS.has(envelope.strategyId)) throw new Error('The envelope contains an unknown ICE strategy.');
  if (typeof envelope.sessionId !== 'string' || envelope.sessionId.length < 8 || envelope.sessionId.length > 128) {
    throw new Error('The envelope contains an invalid session identifier.');
  }
  if (envelope.description?.type !== envelope.kind || typeof envelope.description?.sdp !== 'string') {
    throw new Error('The envelope does not contain a matching RTC session description.');
  }
  if (!envelope.description.sdp.startsWith('v=0') || envelope.description.sdp.length > 350_000) {
    throw new Error('The envelope contains invalid or oversized SDP.');
  }
  return envelope;
}
