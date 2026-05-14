const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { test } = require('node:test');
const path = require('node:path');

const compiledDir = path.join(__dirname, '..', '..', 'dist', 'unit');
const todex = require(path.join(compiledDir, 'todex.js'));
const transport = require(path.join(compiledDir, 'transport.js'));
const transportCrypto = require(path.join(compiledDir, 'transportCrypto.js'));
let executedTests = 0;

process.on('exit', () => {
  assert.equal(executedTests, 17);
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
    defaultReasoningEffort: 'medium',
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

test('parses Codex model list responses with reasoning efforts', () => {
  executedTests += 1;
  const parsed = todex.parseCodexModelListResponse({
    data: [{
      id: 'gpt-5.4',
      model: 'gpt-5.4',
      displayName: 'GPT 5.4',
      description: 'Everyday coding',
      isDefault: true,
      supportedReasoningEfforts: [
        { reasoningEffort: 'low', description: 'Fast responses' },
        { reasoningEffort: 'high', description: 'Deeper reasoning' },
      ],
      defaultReasoningEffort: 'high',
    }],
  });

  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].model, 'gpt-5.4');
  assert.equal(parsed[0].displayName, 'GPT 5.4');
  assert.equal(parsed[0].defaultReasoningEffort, 'high');
  assert.deepEqual(parsed[0].supportedReasoningEfforts.map((item) => item.reasoningEffort), ['low', 'high']);
});

test('parses legacy snake_case model catalog shapes', () => {
  executedTests += 1;
  const parsed = todex.parseCodexModelListResponse({
    result: {
      models: [{
        slug: 'gpt-5.3-codex',
        display_name: 'Codex',
        supported_reasoning_levels: [{ effort: 'extra-high', description: 'Maximum' }],
        default_reasoning_level: 'medium',
      }],
    },
  });

  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].model, 'gpt-5.3-codex');
  assert.equal(parsed[0].displayName, 'Codex');
  assert.equal(parsed[0].defaultReasoningEffort, 'medium');
  assert.equal(parsed[0].supportedReasoningEfforts[0].reasoningEffort, 'xhigh');
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

test('transport client unwraps enveloped server events', () => {
  executedTests += 1;
  const client = new transport.TodeXTransportClient({ loadSessionCursors: () => ({}) });
  const events = client.decode(JSON.stringify({
    type: 'transport.event',
    payload: {
      streamId: 'stream-1',
      seqId: 1,
      sessionId: 'session-1',
      cursor: 4,
      payload: {
        type: 'codex.item.completed',
        payload: { data: { text: 'done' } },
      },
    },
  }));

  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'codex.item.completed');
  assert.equal(events[0].codex_session_id, 'session-1');
  assert.equal(events[0].cursor, 4);
});

test('transport client reassembles chunked frames before decoding events', () => {
  executedTests += 1;
  const client = new transport.TodeXTransportClient({ loadSessionCursors: () => ({}) });
  const payload = JSON.stringify({
    type: 'transport.event',
    payload: {
      streamId: 'stream-1',
      seqId: 2,
      sessionId: 'session-1',
      cursor: 5,
      payload: {
        type: 'codex.item.completed',
        payload: { data: { text: 'chunked' } },
      },
    },
  });
  const first = Buffer.from(payload.slice(0, 30)).toString('base64');
  const second = Buffer.from(payload.slice(30)).toString('base64');

  assert.deepEqual(client.decode(JSON.stringify({
    type: 'transport.chunk',
    payload: {
      chunkId: 'chunk-1',
      index: 1,
      total: 2,
      encoding: 'base64',
      totalBytes: Buffer.byteLength(payload),
      data: second,
    },
  })), []);

  const events = client.decode(JSON.stringify({
    type: 'transport.chunk',
    payload: {
      chunkId: 'chunk-1',
      index: 0,
      total: 2,
      encoding: 'base64',
      totalBytes: Buffer.byteLength(payload),
      data: first,
    },
  }));

  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'codex.item.completed');
  assert.equal(events[0].cursor, 5);
});

test('transport client sends hello, enveloped events, and cursor acks', () => {
  executedTests += 1;
  const sent = [];
  const socket = {
    readyState: 1,
    send: (value) => sent.push(JSON.parse(value)),
  };
  global.WebSocket = { OPEN: 1 };
  const client = new transport.TodeXTransportClient({
    loadSessionCursors: () => ({ 'session-1': 3 }),
  });

  client.attach(socket, (text) => text);
  const message = client.send('codex.local.approval.respond', {
    codexSessionId: 'session-1',
    tenantId: 'local',
  }, 'approval-1');
  client.ack({
    type: 'codex.item.completed',
    codex_session_id: 'session-1',
    cursor: 6,
    payload: {},
  });

  assert.equal(sent[0].type, 'transport.hello');
  assert.deepEqual(sent[0].payload.sessionCursors, { 'session-1': 3 });
  assert.equal(sent[1].type, 'transport.event');
  assert.equal(sent[1].payload.payload.id, 'approval-1');
  assert.equal(message.id, 'approval-1');
  assert.equal(sent[2].type, 'transport.ack');
  assert.equal(sent[2].payload.cursor, 6);
});

test('parses native Codex thread list responses', () => {
  executedTests += 1;
  const parsed = todex.parseCodexNativeThreadListResponse({
    result: {
      data: [
        {
          id: 'thr_1',
          name: 'Native thread',
          preview: 'hello world',
          status: { type: 'idle' },
          createdAt: 100,
          updatedAt: 120,
          session: { cwd: '/workspace/app' },
          model: 'gpt-5.5',
        },
      ],
    },
  });

  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].id, 'thr_1');
  assert.equal(parsed[0].title, 'Native thread');
  assert.equal(parsed[0].status, 'idle');
  assert.equal(parsed[0].cwd, '/workspace/app');
  assert.equal(parsed[0].updatedAt, 120000);
});

test('parses native Codex thread objects from control responses', () => {
  executedTests += 1;
  const parsed = todex.parseCodexNativeThread({
    payload: {
      data: {
        result: {
          thread: {
            id: 'thr_forked',
            preview: 'forked work',
            archived: false,
          },
        },
      },
    },
  });

  assert.ok(parsed);
  assert.equal(parsed.id, 'thr_forked');
  assert.equal(parsed.title, 'forked work');
  assert.equal(parsed.archived, false);
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

test('parses embedded pairing links and applies encrypted settings', async () => {
  executedTests += 1;
  const pairing = await transportCrypto.resolvePairingPayload(JSON.stringify({
    kind: 'todex-pairing-link',
    version: 1,
    serverUrl: 'http://127.0.0.1:7345',
    authToken: 'token',
    preferredEncryption: 'x25519',
    protocol: { id: 'x25519', publicKey: 'x-key' },
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

test('imports pairing links with embedded selected public keys', async () => {
  executedTests += 1;
  const requests = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    throw new TypeError('Network request failed');
  };

  try {
    const pairing = await transportCrypto.resolvePairingPayload(JSON.stringify({
      kind: 'todex-pairing-link',
      version: 1,
      serverUrl: 'http://phone-visible:7345',
      authToken: 'secret',
      preferredEncryption: 'ml-kem-768',
      protocol: { id: 'ml-kem-768', publicKey: 'kem-key' },
    }));

    assert.deepEqual(requests, []);
    assert.deepEqual(pairing, {
      serverUrl: 'http://phone-visible:7345',
      authToken: 'secret',
      encryptionProtocol: 'ml-kem-768',
      encryptionPublicKey: 'kem-key',
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('reassembles segmented pairing qr frames into an importable payload', async () => {
  executedTests += 1;
  const raw = JSON.stringify({
    kind: 'todex-pairing-link',
    version: 1,
    serverUrl: 'http://phone-visible:7345',
    authToken: 'secret',
    preferredEncryption: 'ml-kem-768',
    protocol: {
      id: 'ml-kem-768',
      publicKey: 'kem-key-'.repeat(180),
    },
  });
  const encoded = Buffer.from(raw, 'utf8').toString('base64url');
  const checksum = crypto.createHash('sha256').update(raw).digest('base64url');
  const chunkSize = 96;
  const total = Math.ceil(encoded.length / chunkSize);
  const frames = Array.from({ length: total }, (_, index) =>
    JSON.stringify({
      kind: 'todex-pairing-chunk',
      version: 1,
      checksum,
      index: index + 1,
      total,
      data: encoded.slice(index * chunkSize, (index + 1) * chunkSize),
    }),
  );

  const parsedFirst = transportCrypto.parsePairingQrFrame(frames[0]);
  assert.equal(parsedFirst.kind, 'chunk');
  assert.equal(parsedFirst.chunk.total, total);
  assert.equal(parsedFirst.chunk.checksum, checksum);

  const assembled = transportCrypto.assemblePairingQrChunkPayload(
    frames.map((frame) => transportCrypto.parsePairingQrFrame(frame).chunk),
  );
  assert.equal(assembled, raw);

  const pairing = await transportCrypto.resolvePairingPayload(assembled);
  assert.deepEqual(pairing, {
    serverUrl: 'http://phone-visible:7345',
    authToken: 'secret',
    encryptionProtocol: 'ml-kem-768',
    encryptionPublicKey: 'kem-key-'.repeat(180),
  });
});

test('rejects pairing links with mismatched embedded public keys', async () => {
  executedTests += 1;
  await assert.rejects(
    () => transportCrypto.resolvePairingPayload(JSON.stringify({
      kind: 'todex-pairing-link',
      version: 1,
      serverUrl: 'http://phone-visible:7345',
      authToken: 'secret',
      preferredEncryption: 'x25519',
      protocol: { id: 'ml-kem-768', publicKey: 'kem-key' },
    })),
    /加密方式和公钥不匹配/,
  );
});

test('rejects encrypted pairing links without embedded public keys', async () => {
  executedTests += 1;
  await assert.rejects(
    () => transportCrypto.resolvePairingPayload(JSON.stringify({
      kind: 'todex-pairing-link',
      version: 1,
      serverUrl: 'http://127.0.0.1:7345',
      authToken: 'secret',
      preferredEncryption: 'x25519',
    })),
    /缺少当前加密方式的公钥/,
  );
});

test('does not create crypto sessions for plaintext and rejects missing keys', () => {
  executedTests += 1;
  assert.equal(transportCrypto.createTransportCryptoSession(baseSettings()), null);
  assert.throws(
    () => transportCrypto.createTransportCryptoSession(baseSettings({ encryptionProtocol: 'x25519' })),
    /未配置加密公钥/,
  );
});
