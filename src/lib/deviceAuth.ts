import { ed25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';

/**
 * Per-device Ed25519 identity. `secretKey` is the 32-byte seed (base64url);
 * it never leaves client storage. `deviceId` is `dev_` + base64url of the
 * first 12 bytes of SHA-256(public key), matching the daemon's registry.
 */
export type DeviceIdentity = {
  deviceId: string;
  publicKey: string;
  secretKey: string;
};

const SIGN_DOMAIN = 'todex.device-auth.v1';
const AUTH_QUERY_KEYS = new Set(['device_id', 'auth_ts', 'auth_nonce', 'auth_sig']);

const encoder = new TextEncoder();

export function generateDeviceIdentity(): DeviceIdentity {
  return identityFromSecretKey(ed25519.utils.randomSecretKey());
}

export function deviceIdFromPublicKey(publicKey: Uint8Array): string {
  return `dev_${encodeBase64Url(sha256(publicKey).slice(0, 12))}`;
}

/** Rehydrate the identity from a stored 32-byte seed (base64url). Returns
 * null for missing or malformed secrets so callers can trigger pairing. */
export function deviceIdentityFromSecret(secret: string | null | undefined): DeviceIdentity | null {
  if (!secret) return null;
  let bytes: Uint8Array;
  try {
    bytes = decodeBase64Url(secret);
  } catch {
    return null;
  }
  if (bytes.length !== 32) return null;
  return identityFromSecretKey(bytes);
}

export function identityFromSecretKey(secretKey: Uint8Array): DeviceIdentity {
  const publicKey = ed25519.getPublicKey(secretKey);
  return {
    deviceId: deviceIdFromPublicKey(publicKey),
    publicKey: encodeBase64Url(publicKey),
    secretKey: encodeBase64Url(secretKey),
  };
}

function identityKey(identity: DeviceIdentity): Uint8Array {
  return decodeBase64Url(identity.secretKey);
}

/** Signed payload: `todex.device-auth.v1\0` + deviceId, method, path,
 * canonical query, timestamp, nonce, base64url(sha256(body)) — NUL-joined. */
export function signedPayload(
  deviceId: string,
  method: string,
  path: string,
  canonicalQuery: string,
  timestamp: string,
  nonce: string,
  body: Uint8Array,
): Uint8Array {
  const bodyHash = encodeBase64Url(sha256(body));
  return encoder.encode(
    `${SIGN_DOMAIN}\0${deviceId}\0${method}\0${path}\0${canonicalQuery}\0${timestamp}\0${nonce}\0${bodyHash}`,
  );
}

/** application/x-www-form-urlencoded decoding: '+' is a space, %XX a byte. */
function formDecode(value: string): string {
  const bytes = encoder.encode(value);
  const decoded: number[] = [];
  for (let index = 0; index < bytes.length; index += 1) {
    const byte = bytes[index];
    if (byte === 0x2b /* + */) {
      decoded.push(0x20);
    } else if (
      byte === 0x25 /* % */
      && index + 2 < bytes.length + 1
      && isHexDigit(bytes[index + 1])
      && isHexDigit(bytes[index + 2])
    ) {
      decoded.push((hexValue(bytes[index + 1]) << 4) | hexValue(bytes[index + 2]));
      index += 2;
    } else {
      decoded.push(byte);
    }
  }
  return new TextDecoder().decode(new Uint8Array(decoded));
}

function isHexDigit(byte: number | undefined): boolean {
  if (byte === undefined) return false;
  return (byte >= 0x30 && byte <= 0x39)
    || (byte >= 0x41 && byte <= 0x46)
    || (byte >= 0x61 && byte <= 0x66);
}

function hexValue(byte: number): number {
  if (byte >= 0x30 && byte <= 0x39) return byte - 0x30;
  if (byte >= 0x41 && byte <= 0x46) return byte - 0x41 + 10;
  return byte - 0x61 + 10;
}

/** RFC 3986 unreserved characters pass through; everything else is %XX. */
function strictEncode(value: string): string {
  let output = '';
  for (const byte of encoder.encode(value)) {
    const char = String.fromCharCode(byte);
    output += /[A-Za-z0-9\-._~]/.test(char) ? char : `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
  }
  return output;
}

/** Canonical signed-query form: decode form pairs, drop auth keys, re-encode
 * each side, sort. Must byte-match the daemon's canonicalization. */
export function canonicalQuery(query: string): string {
  if (!query) return '';
  const pairs = query
    .split('&')
    .filter((pair) => pair.length > 0)
    .map((pair) => {
      const separator = pair.indexOf('=');
      const key = separator < 0 ? pair : pair.slice(0, separator);
      const value = separator < 0 ? '' : pair.slice(separator + 1);
      return [strictEncode(formDecode(key)), strictEncode(formDecode(value))] as const;
    })
    .filter(([key]) => !AUTH_QUERY_KEYS.has(key));
  pairs.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return pairs.map(([key, value]) => `${key}=${value}`).join('&');
}

function splitPathAndQuery(pathAndQuery: string): { path: string; query: string } {
  const separator = pathAndQuery.indexOf('?');
  return separator < 0
    ? { path: pathAndQuery, query: '' }
    : { path: pathAndQuery.slice(0, separator), query: pathAndQuery.slice(separator + 1) };
}

function freshNonce(): string {
  const nonce = new Uint8Array(16);
  globalThis.crypto.getRandomValues(nonce);
  return encodeBase64Url(nonce);
}

function unixTimestamp(): string {
  return String(Math.floor(Date.now() / 1000));
}

export type DeviceAuthHeaders = {
  'x-todex-device-id': string;
  'x-todex-auth-ts': string;
  'x-todex-auth-nonce': string;
  'x-todex-auth-sig': string;
};

/** Headers for an authenticated HTTP request (or a WS handshake that can set
 * headers). `pathAndQuery` is the request target as sent on the wire. */
export function deviceAuthHeaders(
  identity: DeviceIdentity,
  method: string,
  pathAndQuery: string,
  body: Uint8Array = new Uint8Array(),
): DeviceAuthHeaders {
  const { path, query } = splitPathAndQuery(pathAndQuery);
  const timestamp = unixTimestamp();
  const nonce = freshNonce();
  const signature = encodeBase64Url(
    ed25519.sign(
      signedPayload(identity.deviceId, method, path, canonicalQuery(query), timestamp, nonce, body),
      identityKey(identity),
    ),
  );
  return {
    'x-todex-device-id': identity.deviceId,
    'x-todex-auth-ts': timestamp,
    'x-todex-auth-nonce': nonce,
    'x-todex-auth-sig': signature,
  };
}

/** Equivalent credential as URL query parameters for clients that cannot set
 * headers (browser/Electron WebSocket). The signature covers the existing
 * query — including transport-encryption handshake parameters. */
export function deviceAuthQuery(identity: DeviceIdentity, pathAndQuery: string): string {
  const { path, query } = splitPathAndQuery(pathAndQuery);
  const timestamp = unixTimestamp();
  const nonce = freshNonce();
  const signature = encodeBase64Url(
    ed25519.sign(
      signedPayload(identity.deviceId, 'GET', path, canonicalQuery(query), timestamp, nonce, new Uint8Array()),
      identityKey(identity),
    ),
  );
  return `device_id=${identity.deviceId}&auth_ts=${timestamp}&auth_nonce=${nonce}&auth_sig=${signature}`;
}

export function encodeBase64Url(bytes: Uint8Array): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let output = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index];
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    const chunk = (first << 16) | ((second ?? 0) << 8) | (third ?? 0);
    output += alphabet[(chunk >> 18) & 63];
    output += alphabet[(chunk >> 12) & 63];
    if (index + 1 < bytes.length) output += alphabet[(chunk >> 6) & 63];
    if (index + 2 < bytes.length) output += alphabet[chunk & 63];
  }
  return output;
}

export function decodeBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = typeof atob === 'function'
    ? atob(padded)
    : (() => {
        const buffer = (globalThis as { Buffer?: { from: (input: string, encoding: string) => { toString: (encoding: string) => string } } }).Buffer;
        if (!buffer) throw new Error('base64url decode unavailable');
        return buffer.from(padded, 'base64').toString('binary');
      })();
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
