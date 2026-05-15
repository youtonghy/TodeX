const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { test } = require('node:test');
const path = require('node:path');

const compiledDir = path.join(__dirname, '..', '..', 'dist', 'unit');
const todex = require(path.join(compiledDir, 'todex.js'));
const transport = require(path.join(compiledDir, 'transport.js'));
const transportCrypto = require(path.join(compiledDir, 'transportCrypto.js'));

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
  assert.equal(todex.normalizeReasoningEffort('high'), 'high');
  assert.equal(todex.normalizeReasoningEffort('extra-high'), 'xhigh');
  assert.equal(todex.normalizeReasoningEffort('max'), 'xhigh');
  assert.equal(todex.normalizeReasoningEffort('default'), 'medium');
  assert.equal(todex.normalizeReasoningEffort('unknown'), null);
});

test('parses Codex model list responses with reasoning efforts', () => {
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
  client.flushAcks();

  assert.equal(sent[0].type, 'transport.hello');
  assert.deepEqual(sent[0].payload.sessionCursors, { 'session-1': 3 });
  assert.equal(sent[1].type, 'transport.event');
  assert.equal(sent[1].payload.payload.id, 'approval-1');
  assert.equal(message.id, 'approval-1');
  assert.equal(sent[2].type, 'transport.ack');
  assert.equal(sent[2].payload.cursor, 6);
});

test('transport client batches cursor acks by session', () => {
  const sent = [];
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  const originalWebSocket = global.WebSocket;
  try {
    const timers = [];
    global.setTimeout = (fn) => {
      timers.push(fn);
      return timers.length;
    };
    global.clearTimeout = () => {};
    global.WebSocket = { OPEN: 1 };
    const client = new transport.TodeXTransportClient({
      loadSessionCursors: () => ({}),
    });
    client.attach({ readyState: 1, send: (value) => sent.push(JSON.parse(value)) }, (text) => text);

    client.ack({ type: 'codex.item.completed', codex_session_id: 'session-1', cursor: 4, payload: {} });
    client.ack({ type: 'codex.item.completed', codex_session_id: 'session-1', cursor: 7, payload: {} });
    assert.equal(sent.filter((item) => item.type === 'transport.ack').length, 0);
    timers.splice(0).forEach((timer) => timer());

    assert.equal(sent.filter((item) => item.type === 'transport.ack').length, 1);
    assert.equal(sent[1].payload.cursor, 7);
  } finally {
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
    global.WebSocket = originalWebSocket;
  }
});

test('transport chunk reassembly decodes directly into a single byte buffer', () => {
  const client = new transport.TodeXTransportClient({ loadSessionCursors: () => ({}) });
  const payload = JSON.stringify({
    type: 'transport.event',
    payload: {
      sessionId: 'session-1',
      cursor: 9,
      payload: { type: 'codex.item.completed', payload: { data: { text: 'abc' } } },
    },
  });
  const encoded = Buffer.from(payload, 'utf8').toString('base64');
  const first = encoded.slice(0, Math.ceil(encoded.length / 2));
  const second = encoded.slice(Math.ceil(encoded.length / 2));

  assert.deepEqual(client.decode(JSON.stringify({
    type: 'transport.chunk',
    payload: {
      chunkId: 'chunk-2',
      index: 0,
      total: 2,
      encoding: 'base64',
      totalBytes: Buffer.byteLength(payload),
      data: first,
    },
  })), []);

  const events = client.decode(JSON.stringify({
    type: 'transport.chunk',
    payload: {
      chunkId: 'chunk-2',
      index: 1,
      total: 2,
      encoding: 'base64',
      totalBytes: Buffer.byteLength(payload),
      data: second,
    },
  }));

  assert.equal(events.length, 1);
  assert.equal(events[0].cursor, 9);
});

test('parses native Codex thread list responses', () => {
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

test('parses native Codex thread/read responses into chat history entries', () => {
  const parsed = todex.parseCodexNativeThreadReadResponse({
    result: {
      thread: {
        id: 'thr_cli_1',
        name: 'CLI created task',
        preview: 'Fix the history sync',
        cwd: '/workspace/app',
        createdAt: 1700000000,
        updatedAt: 1700000060,
        turns: [
          {
            id: 'turn_1',
            startedAt: 1700000001,
            completedAt: 1700000005,
            items: [
              {
                type: 'userMessage',
                id: 'user_1',
                content: [{ type: 'text', text: 'CLI user prompt' }],
              },
              {
                type: 'agentMessage',
                id: 'agent_1',
                text: 'APP should display this answer',
              },
            ],
          },
        ],
      },
    },
  });

  assert.ok(parsed);
  assert.equal(parsed.thread.id, 'thr_cli_1');
  assert.deepEqual(parsed.history.map((entry) => [entry.kind, entry.title, entry.subtitle]), [
    ['outgoing', 'You', 'CLI user prompt'],
    ['incoming', 'Codex', 'APP should display this answer'],
  ]);
  assert.equal(parsed.history[0].at, 1700000005000);
});

test('recognizes non-materialized native thread history errors', () => {
  assert.equal(
    todex.isThreadNotMaterializedHistoryError(
      'thread thr_empty is not materialized yet; includeTurns is unavailable before first user message',
    ),
    true,
  );
  assert.equal(
    todex.isThreadNotMaterializedHistoryError('thread not found'),
    false,
  );
});

test('classifies approval requests and builds matching response payloads', () => {
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
  assert.equal(transportCrypto.createTransportCryptoSession(baseSettings()), null);
  assert.throws(
    () => transportCrypto.createTransportCryptoSession(baseSettings({ encryptionProtocol: 'x25519' })),
    /未配置加密公钥/,
  );
});

test('assembles segmented pairing qr payloads through the optimized base64url path', () => {
  const raw = JSON.stringify({
    kind: 'todex-pairing-link',
    version: 1,
    serverUrl: 'http://phone-visible:7345',
    authToken: 'secret',
    preferredEncryption: 'ml-kem-768',
    protocol: { id: 'ml-kem-768', publicKey: 'kem-key-'.repeat(64) },
  });
  const encoded = Buffer.from(raw, 'utf8').toString('base64url');
  const checksum = crypto.createHash('sha256').update(raw).digest('base64url');
  const chunkSize = 72;
  const total = Math.ceil(encoded.length / chunkSize);
  const chunks = Array.from({ length: total }, (_, index) => ({
    checksum,
    index: index + 1,
    total,
    data: encoded.slice(index * chunkSize, (index + 1) * chunkSize),
  }));

  assert.equal(
    transportCrypto.assemblePairingQrChunkPayload(chunks),
    raw,
  );
});
