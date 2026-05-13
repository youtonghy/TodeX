import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { x25519 } from '@noble/curves/ed25519.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { ml_kem768 } from '@noble/post-quantum/ml-kem.js';

import type { ConnectionSettings } from './todex';

export type TransportEncryptionProtocol = 'none' | 'x25519' | 'ml-kem-768';

type PairingProtocol = {
  id: string;
  publicKey: string;
};

export type PairingPayload = {
  kind: 'todex-pairing';
  version: number;
  serverUrl: string;
  wsUrl?: string;
  host?: string;
  port?: number;
  authToken?: string;
  preferredEncryption?: TransportEncryptionProtocol;
  protocols: PairingProtocol[];
};

type PairingLinkPayload = {
  kind: 'todex-pairing-link';
  version: number;
  serverUrl: string;
  pairingUrl: string;
  authToken?: string;
  preferredEncryption?: TransportEncryptionProtocol;
};

export type ParsedPairing = {
  serverUrl: string;
  authToken: string;
  encryptionProtocol: TransportEncryptionProtocol;
  encryptionPublicKey: string;
  importWarning?: string;
};

export type TransportCryptoSession = {
  protocol: Exclude<TransportEncryptionProtocol, 'none'>;
  queryString: string;
  encryptClientText: (plaintext: string) => string;
  decryptServerText: (frame: string) => string;
};

const AAD = utf8('todex-ws-transport-crypto-v1');

export function parsePairingPayload(raw: string): ParsedPairing {
  return parsePairingObject(JSON.parse(raw) as Partial<PairingPayload>);
}

export async function resolvePairingPayload(raw: string): Promise<ParsedPairing> {
  const parsed = JSON.parse(raw) as Partial<PairingPayload | PairingLinkPayload>;
  if (parsed.kind !== 'todex-pairing-link') {
    return parsePairingObject(parsed as Partial<PairingPayload>);
  }
  if (parsed.version !== 1 || !parsed.pairingUrl) {
    throw new Error('不是有效的 TodeX 配对链接二维码');
  }
  const linkPairing = parsePairingLinkObject(parsed);
  try {
    const response = await fetchPairingLink(parsed);
    if (!response.ok) {
      return {
        ...linkPairing,
        importWarning: `读取后端配对密钥失败: HTTP ${response.status}`,
      };
    }
    const pairingPayload = (await response.json()) as Partial<PairingPayload>;
    const pairing = parsePairingObject({
      ...pairingPayload,
      preferredEncryption: parsed.preferredEncryption ?? pairingPayload.preferredEncryption,
    });
    return {
      ...pairing,
      serverUrl: parsed.serverUrl || pairing.serverUrl,
      authToken: parsed.authToken ?? pairing.authToken,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : '读取后端配对密钥失败';
    return {
      ...linkPairing,
      importWarning: message,
    };
  }
}

function parsePairingLinkObject(parsed: Partial<PairingLinkPayload>): ParsedPairing {
  if (parsed.kind !== 'todex-pairing-link' || parsed.version !== 1) {
    throw new Error('不是有效的 TodeX 配对链接二维码');
  }
  if (!parsed.serverUrl) {
    throw new Error('配对二维码缺少后端地址');
  }
  return {
    serverUrl: parsed.serverUrl,
    authToken: parsed.authToken ?? '',
    encryptionProtocol: normalizePairingProtocol(parsed.preferredEncryption) ?? 'none',
    encryptionPublicKey: '',
  };
}

function parsePairingObject(parsed: Partial<PairingPayload>): ParsedPairing {
  if (parsed.kind !== 'todex-pairing' || parsed.version !== 1) {
    throw new Error('不是有效的 TodeX 配对二维码');
  }
  if (parsed.preferredEncryption === 'none') {
    if (!parsed.serverUrl) {
      throw new Error('配对二维码缺少后端地址');
    }
    return {
      serverUrl: parsed.serverUrl,
      authToken: parsed.authToken ?? '',
      encryptionProtocol: 'none',
      encryptionPublicKey: '',
    };
  }
  const protocols = Array.isArray(parsed.protocols) ? parsed.protocols : [];
  const preferred = parsed.preferredEncryption;
  const selected =
    (preferred ? protocols.find((protocol) => protocol.id === preferred) : undefined) ??
    protocols.find((protocol) => protocol.id === 'ml-kem-768') ??
    protocols.find((protocol) => protocol.id === 'x25519');
  if (!selected?.publicKey) {
    throw new Error('配对二维码缺少可用加密公钥');
  }
  if (selected.id !== 'x25519' && selected.id !== 'ml-kem-768') {
    throw new Error(`不支持的加密协议: ${selected.id}`);
  }
  if (!parsed.serverUrl) {
    throw new Error('配对二维码缺少后端地址');
  }

  return {
    serverUrl: parsed.serverUrl,
    authToken: parsed.authToken ?? '',
    encryptionProtocol: selected.id,
    encryptionPublicKey: selected.publicKey,
  };
}

function normalizePairingProtocol(protocol: unknown): TransportEncryptionProtocol | null {
  return protocol === 'none' || protocol === 'x25519' || protocol === 'ml-kem-768' ? protocol : null;
}

export function applyPairingToSettings(
  settings: ConnectionSettings,
  pairing: ParsedPairing,
): ConnectionSettings {
  return {
    ...settings,
    serverUrl: pairing.serverUrl,
    authToken: pairing.authToken,
    encryptionProtocol: pairing.encryptionProtocol,
    encryptionPublicKey: pairing.encryptionPublicKey,
  };
}

async function fetchPairingLink(parsed: Partial<PairingLinkPayload>): Promise<Response> {
  try {
    return await fetch(parsed.pairingUrl!, {
      headers: parsed.authToken ? { Authorization: `Bearer ${parsed.authToken}` } : undefined,
    });
  } catch (error) {
    throw new Error(pairingNetworkErrorMessage(parsed.pairingUrl!, error));
  }
}

function pairingNetworkErrorMessage(pairingUrl: string, error: unknown): string {
  const detail = error instanceof Error && error.message ? ` (${error.message})` : '';
  const hint =
    pairingUrlHasLocalOnlyHost(pairingUrl)
      ? '二维码里的地址只在后端本机可用。请用 `cargo run -- tui --host 0.0.0.0` 或在 TUI 里把 listen IP 改成 0.0.0.0 后重启服务，再重新扫码。'
      : '请确认手机和后端在同一网络、后端监听的是 0.0.0.0 或局域网 IP，并且移动端构建已允许 HTTP 明文访问。';
  return `无法连接后端配对接口${detail}。${hint}`;
}

function pairingUrlHasLocalOnlyHost(pairingUrl: string): boolean {
  try {
    const host = new URL(pairingUrl).hostname.toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '0.0.0.0' || host === '::';
  } catch {
    return false;
  }
}

export function createTransportCryptoSession(settings: ConnectionSettings): TransportCryptoSession | null {
  if (settings.encryptionProtocol === 'none') {
    return null;
  }
  const protocol = settings.encryptionProtocol;
  const serverPublicKey = decodeBase64Url(settings.encryptionPublicKey.trim());
  if (serverPublicKey.length === 0) {
    throw new Error('当前连接未配置加密公钥，请扫描后端配对二维码。');
  }

  const handshake =
    protocol === 'x25519'
      ? createX25519Handshake(serverPublicKey)
      : createMlKem768Handshake(serverPublicKey);
  const key = hkdf(sha256, handshake.sharedSecret, handshake.salt, utf8(protocol), 32);
  let sendCounter = 0;

  return {
    protocol,
    queryString: handshake.queryString,
    encryptClientText: (plaintext: string) => {
      const nonce = nonceFor(2, sendCounter++);
      const ciphertext = xchacha20poly1305(key, nonce, AAD).encrypt(utf8(plaintext));
      return JSON.stringify({
        type: 'todex.crypto.v1',
        protocol,
        nonce: encodeBase64Url(nonce),
        ciphertext: encodeBase64Url(ciphertext),
      });
    },
    decryptServerText: (frame: string) => {
      const wrapped = JSON.parse(frame) as {
        type?: string;
        protocol?: string;
        nonce?: string;
        ciphertext?: string;
      };
      if (wrapped.type !== 'todex.crypto.v1' || wrapped.protocol !== protocol) {
        throw new Error('收到的加密帧格式不正确');
      }
      if (!wrapped.nonce || !wrapped.ciphertext) {
        throw new Error('收到的加密帧缺少 nonce 或 ciphertext');
      }
      const nonce = decodeBase64Url(wrapped.nonce);
      if (nonce.length !== 24 || nonce[0] !== 1) {
        throw new Error('收到的加密帧方向不正确');
      }
      const plaintext = xchacha20poly1305(key, nonce, AAD).decrypt(
        decodeBase64Url(wrapped.ciphertext),
      );
      return new TextDecoder().decode(plaintext);
    },
  };
}

function createX25519Handshake(serverPublicKey: Uint8Array): {
  queryString: string;
  sharedSecret: Uint8Array;
  salt: Uint8Array;
} {
  if (serverPublicKey.length !== 32) {
    throw new Error('X25519 服务端公钥长度不正确');
  }
  const keyPair = x25519.keygen();
  const sharedSecret = x25519.getSharedSecret(keyPair.secretKey, serverPublicKey);
  const salt = concatBytes(serverPublicKey, keyPair.publicKey);
  const queryString = new URLSearchParams({
    enc: 'x25519',
    client_key: encodeBase64Url(keyPair.publicKey),
  }).toString();
  return { queryString, sharedSecret, salt };
}

function createMlKem768Handshake(serverPublicKey: Uint8Array): {
  queryString: string;
  sharedSecret: Uint8Array;
  salt: Uint8Array;
} {
  const { cipherText, sharedSecret } = ml_kem768.encapsulate(serverPublicKey);
  const salt = concatBytes(serverPublicKey, cipherText);
  const queryString = new URLSearchParams({
    enc: 'ml-kem-768',
    ciphertext: encodeBase64Url(cipherText),
  }).toString();
  return { queryString, sharedSecret, salt };
}

function nonceFor(direction: number, counter: number): Uint8Array {
  const nonce = new Uint8Array(24);
  nonce[0] = direction;
  const view = new DataView(nonce.buffer);
  view.setBigUint64(8, BigInt(counter), true);
  return nonce;
}

function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const length = arrays.reduce((sum, value) => sum + value.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const value of arrays) {
    output.set(value, offset);
    offset += value.length;
  }
  return output;
}

function encodeBase64Url(bytes: Uint8Array): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let output = '';
  for (let idx = 0; idx < bytes.length; idx += 3) {
    const first = bytes[idx];
    const second = bytes[idx + 1];
    const third = bytes[idx + 2];
    const chunk = (first << 16) | ((second ?? 0) << 8) | (third ?? 0);
    output += alphabet[(chunk >> 18) & 63];
    output += alphabet[(chunk >> 12) & 63];
    if (idx + 1 < bytes.length) {
      output += alphabet[(chunk >> 6) & 63];
    }
    if (idx + 2 < bytes.length) {
      output += alphabet[chunk & 63];
    }
  }
  return output;
}

function decodeBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const bytes: number[] = [];
  for (let idx = 0; idx < padded.length; idx += 4) {
    const chunk = padded.slice(idx, idx + 4);
    const values = [...chunk].map((char) => (char === '=' ? 0 : alphabet.indexOf(char)));
    if (values.some((entry) => entry < 0)) {
      throw new Error('无效的 base64url 数据');
    }
    const triplet = (values[0] << 18) | (values[1] << 12) | (values[2] << 6) | values[3];
    bytes.push((triplet >> 16) & 255);
    if (chunk[2] !== '=') {
      bytes.push((triplet >> 8) & 255);
    }
    if (chunk[3] !== '=') {
      bytes.push(triplet & 255);
    }
  }
  return new Uint8Array(bytes);
}
