const assert = require('node:assert/strict');
const { test } = require('node:test');
const path = require('node:path');

const compiledDir = path.join(__dirname, '..', '..', 'dist', 'unit');
const todex = require(path.join(compiledDir, 'todex.js'));
const transportCrypto = require(path.join(compiledDir, 'transportCrypto.js'));
let executedTests = 0;

process.on('exit', () => {
  assert.equal(executedTests, 8);
});

function baseSettings(overrides = {}) {
  return {
    serverUrl: '127.0.0.1:7345',
    authToken: '',
    tenantId: 'local',
    encryptionProtocol: 'none',
    encryptionPublicKey: '',
    defaultWorkspacePath: '/workspace',
    defaultModel: 'gpt-5.5',
    approvalPolicy: 'on-request',
    sandboxMode: 'workspace-write',
    ...overrides,
  };
}

test('builds HTTP and WebSocket URLs from flexible server addresses', () => {
  executedTests += 1;
  assert.equal(
    todex.buildHttpUrl('127.0.0.1:7345', '/v1/version'),
    'http://127.0.0.1:7345/v1/version',
  );
  assert.equal(
    todex.buildHttpUrl('wss://agent.example.test/base', '/health'),
    'https://agent.example.test/health',
  );
  assert.equal(
    todex.buildWebSocketUrl('https://agent.example.test', 'enc=x25519&client_key=abc'),
    'wss://agent.example.test/v1/ws?enc=x25519&client_key=abc',
  );
  assert.equal(
    todex.buildWebSocketUrl('ws://127.0.0.1:7345/path', '?enc=ml-kem-768'),
    'ws://127.0.0.1:7345/v1/ws?enc=ml-kem-768',
  );
});

test('normalizes Codex reasoning effort aliases', () => {
  executedTests += 1;
  assert.equal(todex.normalizeReasoningEffort('high'), 'high');
  assert.equal(todex.normalizeReasoningEffort('extra-high'), 'xhigh');
  assert.equal(todex.normalizeReasoningEffort('max'), 'xhigh');
  assert.equal(todex.normalizeReasoningEffort('default'), 'medium');
  assert.equal(todex.normalizeReasoningEffort('unknown'), null);
});

test('extracts thread ids from nested server event payloads', () => {
  executedTests += 1;
  assert.equal(
    todex.extractThreadIdFromEvent({
      type: 'codex.local.turn.completed',
      payload: {
        data: {
          result: {
            thread: {
              id: 'thread-nested',
            },
          },
        },
      },
    }),
    'thread-nested',
  );
  assert.equal(
    todex.extractThreadIdFromEvent({
      type: 'codex.local.turn.delta',
      codex_thread_id: 'thread-top-level',
      payload: {},
    }),
    'thread-top-level',
  );
});

test('classifies approval requests and builds matching response payloads', () => {
  executedTests += 1;
  const event = {
    type: 'codex.approval.permissions.request',
    payload: {
      data: {
        requestId: 'perm-1',
        permissions: {
          filesystem: 'workspace-write',
        },
      },
    },
  };
  const request = todex.classifyPendingRequest(event);

  assert.equal(request.requestId, 'perm-1');
  assert.equal(request.title, 'perm-1 · permission approval');
  assert.equal(
    todex.inferApprovalResponseType(request.requestType),
    'codex.approval.permissions.respond',
  );
  assert.deepEqual(todex.approvalResponsePayload(request, true), {
    permissions: {
      filesystem: 'workspace-write',
    },
    scope: 'turn',
    strictAutoReview: false,
  });
  assert.deepEqual(todex.approvalResponsePayload(request, false), {
    permissions: {},
    scope: 'turn',
    strictAutoReview: false,
  });
});

test('parses pairing payloads and applies encrypted settings', () => {
  executedTests += 1;
  const pairing = transportCrypto.parsePairingPayload(JSON.stringify({
    kind: 'todex-pairing',
    version: 1,
    serverUrl: 'http://127.0.0.1:7345',
    authToken: 'token',
    preferredEncryption: 'x25519',
    protocols: [
      { id: 'x25519', publicKey: 'x-key' },
      { id: 'ml-kem-768', publicKey: 'kem-key' },
    ],
  }));

  assert.deepEqual(pairing, {
    serverUrl: 'http://127.0.0.1:7345',
    authToken: 'token',
    encryptionProtocol: 'x25519',
    encryptionPublicKey: 'x-key',
  });
  assert.deepEqual(transportCrypto.applyPairingToSettings(baseSettings(), pairing), {
    ...baseSettings(),
    serverUrl: 'http://127.0.0.1:7345',
    authToken: 'token',
    encryptionProtocol: 'x25519',
    encryptionPublicKey: 'x-key',
  });
});

test('resolves pairing links through the configured authenticated endpoint', async () => {
  executedTests += 1;
  const requests = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    return {
      ok: true,
      async json() {
        return {
          kind: 'todex-pairing',
          version: 1,
          serverUrl: 'http://backend-internal:7345',
          protocols: [
            { id: 'x25519', publicKey: 'x-key' },
            { id: 'ml-kem-768', publicKey: 'kem-key' },
          ],
        };
      },
    };
  };

  try {
    const pairing = await transportCrypto.resolvePairingPayload(JSON.stringify({
      kind: 'todex-pairing-link',
      version: 1,
      serverUrl: 'http://phone-visible:7345',
      pairingUrl: 'http://backend-internal:7345/v1/pairing',
      authToken: 'secret',
      preferredEncryption: 'x25519',
    }));

    assert.deepEqual(requests, [{
      url: 'http://backend-internal:7345/v1/pairing',
      options: { headers: { Authorization: 'Bearer secret' } },
    }]);
    assert.deepEqual(pairing, {
      serverUrl: 'http://phone-visible:7345',
      authToken: 'secret',
      encryptionProtocol: 'x25519',
      encryptionPublicKey: 'x-key',
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('imports pairing link settings even when the key endpoint is unreachable', async () => {
  executedTests += 1;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new TypeError('Network request failed');
  };

  try {
    const pairing = await transportCrypto.resolvePairingPayload(JSON.stringify({
      kind: 'todex-pairing-link',
      version: 1,
      serverUrl: 'http://127.0.0.1:7345',
      pairingUrl: 'http://127.0.0.1:7345/v1/pairing',
      authToken: 'secret',
      preferredEncryption: 'x25519',
    }));
    assert.match(pairing.importWarning, /地址只在后端本机可用/);
    assert.deepEqual(pairing, {
      serverUrl: 'http://127.0.0.1:7345',
      authToken: 'secret',
      encryptionProtocol: 'x25519',
      encryptionPublicKey: '',
      importWarning: pairing.importWarning,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('does not create crypto sessions for plaintext and rejects missing keys', () => {
  executedTests += 1;
  assert.equal(transportCrypto.createTransportCryptoSession(baseSettings()), null);
  assert.throws(
    () => transportCrypto.createTransportCryptoSession(baseSettings({ encryptionProtocol: 'x25519' })),
    /未配置加密公钥/,
  );
});
