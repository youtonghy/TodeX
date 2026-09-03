const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const { test } = require('node:test');
const path = require('node:path');

const compiledDir = path.join(__dirname, '..', '..', 'dist', 'unit');
const todex = require(path.join(compiledDir, 'lib', 'todex.js'));
const transport = require(path.join(compiledDir, 'lib', 'transport.js'));
const transportCrypto = require(path.join(compiledDir, 'lib', 'transportCrypto.js'));
const v2 = require(path.join(compiledDir, 'lib', 'v2.js'));
const connectionError = require(path.join(compiledDir, 'lib', 'connectionError.js'));
const connectionProbe = require(path.join(compiledDir, 'lib', 'connectionProbe.js'));

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

test('builds HTTP URLs from flexible server addresses', () => {
  assert.equal(
    todex.buildHttpUrl('127.0.0.1:7345', '/v2/version'),
    'http://127.0.0.1:7345/v2/version',
  );
  assert.equal(
    todex.buildHttpUrl('wss://agent.example.test/base', '/health'),
    'https://agent.example.test/health',
  );
});

test('matches capability references only after whitespace', () => {
  assert.deepEqual(todex.findCapabilityHashTrigger('#skill/build', 12), { start: 0, end: 12, query: 'skill/build' });
  assert.equal(todex.findCapabilityHashTrigger('foo#skill/build', 15), null);
  assert.equal(todex.findCapabilityHashTrigger('#skill/build now', '#skill/build now'.length), null);
  assert.equal(todex.insertCapabilityReference('do #old', { start: 3, end: 7, query: 'old' }, '#skill/new '), 'do #skill/new ');
});

test('builds v2 WebSocket URLs and parses protocol messages', () => {
  assert.equal(v2.buildV2WebSocketUrl('https://agent.example.test/base'), 'wss://agent.example.test/v2/ws');
  assert.equal(v2.buildV2WebSocketUrl('ws://127.0.0.1:7345'), 'ws://127.0.0.1:7345/v2/ws');
  assert.deepEqual(v2.parseV2Message(JSON.stringify({ id: '1', type: 'server.result', payload: { ok: true } })), {
    id: '1', type: 'server.result', payload: { ok: true },
  });
  assert.equal(v2.parseV2Message('{bad json}'), null);
});

test('builds v2 WebSocket URLs with pairing query and encoded access token', () => {
  assert.equal(
    v2.buildV2WebSocketUrlWithOptions('https://agent.example.test', {
      cryptoQueryString: 'enc=x25519&client_key=abc',
    }),
    'wss://agent.example.test/v2/ws?enc=x25519&client_key=abc',
  );
  assert.equal(
    v2.buildV2WebSocketUrlWithOptions('ws://127.0.0.1:7345/path', {
      cryptoQueryString: '?enc=ml-kem-768',
    }),
    'ws://127.0.0.1:7345/v2/ws?enc=ml-kem-768',
  );
  assert.equal(
    v2.buildV2WebSocketUrlWithOptions('http://127.0.0.1:7345', {
      cryptoQueryString: 'enc=none',
      authToken: 'tok&x',
    }),
    'ws://127.0.0.1:7345/v2/ws?enc=none&access_token=tok%26x',
  );
  assert.equal(
    v2.buildV2WebSocketUrlWithToken('http://127.0.0.1:7345', 'tok&x'),
    'ws://127.0.0.1:7345/v2/ws?access_token=tok%26x',
  );
});

test('v2 API client sends bearer auth and JSON requests', async () => {
  const requests = [];
  const client = new v2.V2ApiClient({
    serverUrl: 'http://127.0.0.1:7345',
    authToken: 'secret',
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      return new Response(JSON.stringify({ conversationId: 'c1', turnId: 't1' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
  });
  await client.prompt('c1', 'hello');
  assert.equal(requests[0].url, 'http://127.0.0.1:7345/v2/conversations/c1/prompt');
  assert.equal(requests[0].init.headers.get('Authorization'), 'Bearer secret');
  assert.equal(requests[0].init.headers.get('Content-Type'), 'application/json');
});

test('v2 API client preserves structured backend request errors', async () => {
  const client = new v2.V2ApiClient({
    serverUrl: 'http://127.0.0.1:7345',
    fetchImpl: async () => new Response(JSON.stringify({
      code: 'WORKSPACE_PATH_OUTSIDE_ROOT',
      message: 'workspace path escapes configured workspace root',
    }), { status: 403, headers: { 'Content-Type': 'application/json' } }),
  });
  await assert.rejects(
    () => client.createConversation({ provider: 'codex', workspace: '/outside' }),
    (error) => {
      assert.equal(error.code, 'request_failed');
      assert.equal(error.retryable, false);
      assert.match(error.userMessage, /Backend/);
      assert.match(error.technicalDetails, /WORKSPACE_PATH_OUTSIDE_ROOT/);
      return true;
    },
  );
});

test('v2 API client still classifies explicit auth failures', async () => {
  const client = new v2.V2ApiClient({
    serverUrl: 'http://127.0.0.1:7345',
    fetchImpl: async () => new Response(JSON.stringify({
      code: 'UNAUTHENTICATED',
      message: 'authentication required',
    }), { status: 401, headers: { 'Content-Type': 'application/json' } }),
  });
  await assert.rejects(
    () => client.listConversations(),
    (error) => {
      assert.equal(error.code, 'authentication_failed');
      assert.equal(error.retryable, false);
      return true;
    },
  );
});

test('v2 API client builds read-only capability catalog requests', async () => {
  const requests = [];
  const client = new v2.V2ApiClient({
    serverUrl: 'http://127.0.0.1:7345',
    fetchImpl: async (url) => {
      requests.push(url);
      return new Response(JSON.stringify({ provider: 'codex', skills: [], servers: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
  });
  await client.listSkillCatalog('codex', '/workspace/app');
  await client.getSkillResource('codex', '/workspace/app', 'skill-id');
  await client.listMcpCatalog('codex', '/workspace/app');
  assert.match(requests[0], /\/v2\/catalog\/skills\?provider=codex&workspace=%2Fworkspace%2Fapp/);
  assert.match(requests[1], /\/v2\/catalog\/skills\/skill-id\?provider=codex&workspace=%2Fworkspace%2Fapp/);
  assert.match(requests[2], /\/v2\/catalog\/mcp\?provider=codex&workspace=%2Fworkspace%2Fapp/);
});

test('v2 socket reconnects subscriptions from the latest sequence', () => {
  const sockets = [];
  class FakeSocket {
    static OPEN = 1;
    readyState = 1;
    sent = [];
    constructor() { sockets.push(this); }
    send(value) { this.sent.push(JSON.parse(value)); }
    close() {}
  }
  const client = new v2.V2ConversationSocket({ serverUrl: 'http://127.0.0.1:7345', WebSocketImpl: FakeSocket });
  client.connect();
  sockets[0].onopen();
  client.subscribe('c1', 0, 10);
  sockets[0].onmessage({ data: JSON.stringify({ type: 'conversation.event', payload: { conversationId: 'c1', sequence: 7 } }) });
  sockets[0].onclose();
  client.connect();
  sockets[1].onopen();
  assert.equal(sockets[1].sent[0].type, 'conversation.subscribe');
  assert.equal(sockets[1].sent[0].payload.afterSequence, 7);
  client.close();
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
      serviceTiers: [
        { id: 'priority', name: 'Fast', description: 'Fastest inference' },
        { id: 'flex', name: 'Flex', description: 'Lower-cost flexible routing' },
      ],
    }],
  });

  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].model, 'gpt-5.4');
  assert.equal(parsed[0].displayName, 'GPT 5.4');
  assert.equal(parsed[0].defaultReasoningEffort, 'high');
  assert.deepEqual(parsed[0].supportedReasoningEfforts.map((item) => item.reasoningEffort), ['low', 'high']);
  assert.deepEqual(parsed[0].serviceTiers, [
    { id: 'priority', name: 'fast', description: 'Fastest inference' },
    { id: 'flex', name: 'flex', description: 'Lower-cost flexible routing' },
  ]);
});

test('merges workspace sync records by newest backend or local cache copy', () => {
  const local = [{
    id: 'workspace-1',
    name: 'Old App',
    path: '/workspace/app',
    sessionId: 'cdxs_app',
    tenantId: 'local',
    threadId: 'thread-local',
    model: 'gpt-5.4',
    reasoningEffort: 'medium',
    approvalPolicy: 'on-request',
    sandboxMode: 'workspace-write',
    serviceTier: null,
    permissionProfile: null,
    localAdapterState: 'running',
    createdAt: 10,
    updatedAt: 20,
  }];
  const remote = [{
    ...local[0],
    name: 'Synced App',
    threadId: '',
    localAdapterState: 'idle',
    updatedAt: 30,
  }];

  const merged = todex.mergeWorkspaceRecords(local, remote);

  assert.equal(merged.length, 1);
  assert.equal(merged[0].name, 'Synced App');
  assert.equal(merged[0].localAdapterState, 'running');
});

test('adopts the backend workspace identity without losing newer local metadata', () => {
  const local = {
    id: 'device-workspace', name: 'Locally renamed', path: '/workspace/app', sessionId: 'local-session',
    tenantId: 'local', threadId: '', model: 'gpt-5.5', approvalPolicy: 'on-request',
    sandboxMode: 'workspace-write', localAdapterState: 'running', createdAt: 10, updatedAt: 40,
  };
  const remote = {
    ...local, id: 'ws_canonical', name: 'Older server name', sessionId: 'cdxs_ws_canonical',
    localAdapterState: 'idle', updatedAt: 30,
  };

  const [merged] = todex.mergeWorkspaceRecords([local], [remote]);
  const [conversation] = todex.remapWorkspaceScopedRecords(
    [{ id: 'conversation-1', workspaceId: local.id, body: 'persisted content' }],
    [local],
    [merged],
  );

  assert.equal(merged.id, 'ws_canonical');
  assert.equal(merged.name, 'Locally renamed');
  assert.equal(merged.localAdapterState, 'running');
  assert.equal(conversation.workspaceId, 'ws_canonical');
  assert.equal(conversation.body, 'persisted content');
});

test('prepares workspace sync payload as backend-safe cache records', () => {
  const payload = todex.prepareWorkspaceSyncPayload([{
    id: 'workspace-1',
    name: 'App',
    path: '/workspace/app',
    sessionId: 'cdxs_app',
    tenantId: 'local',
    threadId: 'thread-local',
    model: 'gpt-5.5',
    reasoningEffort: 'extra-high',
    approvalPolicy: 'on-request',
    sandboxMode: 'workspace-write',
    serviceTier: null,
    permissionProfile: null,
    localAdapterState: 'running',
    createdAt: 10,
    updatedAt: 20,
  }]);

  assert.equal(payload[0].threadId, '');
  assert.equal(payload[0].localAdapterState, 'idle');
  assert.equal(payload[0].reasoningEffort, 'xhigh');
});

test('parses workspace personality from camelCase and defaults to null', () => {
  const parsed = todex.parseWorkspaceSyncResponse([
    {
      id: 'workspace-1',
      name: 'App',
      path: '/workspace/app',
      personality: 'pragmatic',
    },
    {
      id: 'workspace-2',
      name: 'Other',
      path: '/workspace/other',
    },
  ]);

  assert.equal(parsed[0].personality, 'pragmatic');
  assert.equal(parsed[1].personality, null);
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

test('parses MCP server status list responses', () => {
  const parsed = todex.parseMcpServerStatusListResponse({
    data: [{
      name: 'docs',
      serverInfo: { title: 'Docs MCP', version: '1.2.3' },
      authStatus: 'oauth',
      tools: {
        search: { name: 'search' },
        read: { name: 'read' },
      },
      resources: [{ uri: 'mcp://docs/readme' }],
      resourceTemplates: [{ uriTemplate: 'mcp://docs/{id}', name: 'doc' }],
    }],
  });

  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].name, 'docs');
  assert.equal(parsed[0].title, 'Docs MCP');
  assert.deepEqual(parsed[0].tools, ['search', 'read']);
  assert.deepEqual(parsed[0].resources, ['mcp://docs/readme']);
  assert.deepEqual(parsed[0].resourceTemplates, ['doc']);
});

test('parses permission profile list responses', () => {
  const parsed = todex.parsePermissionProfileListResponse({
    result: {
      data: [
        { id: ':workspace' },
        { id: 'audit', description: 'Inspect without writes.' },
      ],
    },
  });

  assert.deepEqual(parsed, [
    { id: ':workspace', description: 'Configured permission profile.' },
    { id: 'audit', description: 'Inspect without writes.' },
  ]);
});

test('parses hooks list responses', () => {
  const parsed = todex.parseHooksListResponse({
    result: {
      data: [{
        cwd: '/workspace/app',
        hooks: [{
          key: 'pre-tool',
          eventName: 'PreToolUse',
          handlerType: 'command',
          matcher: '.*',
          command: 'npm test',
          sourcePath: '/workspace/app/.codex/hooks.json',
          enabled: true,
          trustStatus: 'trusted',
          pluginId: 'local',
        }],
        warnings: ['one warning'],
        errors: [],
      }],
    },
  });

  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].cwd, '/workspace/app');
  assert.equal(parsed[0].hooks[0].eventName, 'PreToolUse');
  assert.equal(parsed[0].hooks[0].command, 'npm test');
  assert.deepEqual(parsed[0].warnings, ['one warning']);
});

test('parses plugin list responses', () => {
  const parsed = todex.parsePluginListResponse({
    result: {
      marketplaces: [{
        name: 'personal',
        interface: { displayName: 'Personal' },
        path: '/home/dev/.codex/plugins',
        plugins: [{
          id: 'plugin-1',
          name: 'review-helper',
          interface: {
            displayName: 'Review Helper',
            shortDescription: 'Adds review commands.',
            category: 'dev',
          },
          source: { type: 'local' },
          installed: true,
          enabled: true,
          availability: 'AVAILABLE',
        }],
      }],
      marketplaceLoadErrors: ['bad marketplace'],
      featuredPluginIds: ['plugin-1'],
    },
  });

  assert.equal(parsed.marketplaces.length, 1);
  assert.equal(parsed.marketplaces[0].displayName, 'Personal');
  assert.equal(parsed.marketplaces[0].plugins[0].displayName, 'Review Helper');
  assert.equal(parsed.marketplaces[0].plugins[0].source, 'local');
  assert.deepEqual(parsed.marketplaceLoadErrors, ['bad marketplace']);
  assert.deepEqual(parsed.featuredPluginIds, ['plugin-1']);
});

test('parses memory config responses', () => {
  const parsed = todex.parseMemorySettingsResponse({
    result: {
      config: {
        memories: {
          use_memories: true,
          generate_memories: false,
        },
      },
    },
  });

  assert.deepEqual(parsed, {
    useMemories: true,
    generateMemories: false,
  });
});

test('parses workspace approvals reviewer from sync records', () => {
  const parsed = todex.parseWorkspaceSyncResponse([{
    id: 'workspace-1',
    name: 'App',
    path: '/workspace/app',
    approvalsReviewer: 'auto_review',
  }]);

  assert.equal(parsed[0].approvalsReviewer, 'auto_review');
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

test('extracts session ids and cursors from plain server events', () => {
  assert.equal(transport.sessionIdFromEvent({
    type: 'codex.item.completed',
    codex_session_id: 'session-direct',
    payload: {},
  }), 'session-direct');
  assert.equal(transport.sessionIdFromEvent({
    type: 'codex.item.completed',
    payload: { data: { codexSessionId: 'session-nested' } },
  }), 'session-nested');
  assert.equal(transport.sessionIdFromEvent({ type: 'terminal.output', payload: {} }), '');
  assert.equal(transport.cursorFromEvent({ type: 'codex.item.completed', cursor: 4, payload: {} }), 4);
  assert.equal(transport.cursorFromEvent({ type: 'codex.item.completed', cursor: '7', payload: {} }), 7);
  assert.equal(transport.cursorFromEvent({ type: 'codex.item.completed', payload: {} }), null);
});

test('legacy message guard matches the unified backend socket limit', () => {
  assert.equal(transport.MAX_LEGACY_MESSAGE_BYTES, 8 * 1024 * 1024);
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

test('maintains pending requests incrementally across resolution and replay', () => {
  const resolvedIds = new Set();
  const requestEvent = {
    type: 'codex.approval.permissions.request',
    payload: { data: { requestId: 'perm-incremental' } },
  };
  const request = todex.updatePendingRequestsFromEvent([], requestEvent, resolvedIds);
  assert.equal(request.length, 1);
  assert.equal(request[0].requestId, 'perm-incremental');
  assert.equal(todex.updatePendingRequestsFromEvent(request, requestEvent, resolvedIds), request);

  const resolved = todex.updatePendingRequestsFromEvent(request, {
    type: 'codex.serverRequest.resolved',
    payload: { data: { requestId: 'perm-incremental' } },
  }, resolvedIds);
  assert.deepEqual(resolved, []);
  assert.equal(
    todex.updatePendingRequestsFromEvent(resolved, { ...requestEvent }, resolvedIds),
    resolved,
  );
});

test('resolves v2 permission requests by permission id', () => {
  const resolvedIds = new Set();
  const request = todex.updatePendingRequestsFromEvent([], {
    type: 'conversation.permission.request',
    payload: { requestId: 'v2-permission', permissionId: 'v2-permission' },
  }, resolvedIds);
  const resolved = todex.updatePendingRequestsFromEvent(request, {
    type: 'permission.resolved',
    payload: { permissionId: 'v2-permission' },
  }, resolvedIds);
  assert.deepEqual(resolved, []);
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

test('counts utf8 bytes the way the backend measures frames', () => {
  const cases = [
    '',
    'plain ascii',
    'café',
    '中文消息',
    '😀🎉',
    '\ud83d',
    '\udc00',
    'trailing\ud83d',
    JSON.stringify({ type: '中文', payload: { emoji: '😀' } }),
    'YWJjZA=='.repeat(32),
  ];
  for (const value of cases) {
    assert.equal(
      todex.utf8ByteLength(value),
      Buffer.byteLength(value, 'utf8'),
      `byte length mismatch for ${JSON.stringify(value)}`,
    );
  }

  // String.length would undercount every one of these.
  assert.equal(todex.utf8ByteLength('中文消息'), 12);
  assert.equal(todex.utf8ByteLength('😀'), 4);
  assert.equal('😀'.length, 2);
});

test('v2 socket reports oversized frames instead of throwing', () => {
  const errors = [];
  const sockets = [];
  class FakeSocket {
    static OPEN = 1;
    readyState = 1;
    sent = [];
    constructor() { sockets.push(this); }
    send(value) { this.sent.push(value); }
    close() {}
  }
  const client = new v2.V2ConversationSocket({
    serverUrl: 'http://127.0.0.1:7345',
    WebSocketImpl: FakeSocket,
    onError: (error) => errors.push(error),
  });
  client.connect();
  sockets[0].onopen();
  const sentAfterOpen = sockets[0].sent.length;

  const oversized = '中'.repeat(v2.MAX_MESSAGE_SIZE / 3);
  assert.ok(oversized.length < v2.MAX_MESSAGE_SIZE);
  // v2 has no outbound throw contract; it reports through onError.
  assert.doesNotThrow(() => client.sendPrompt('c1', oversized));

  assert.equal(sockets[0].sent.length, sentAfterOpen, 'oversized frame must not reach the socket');
  assert.equal(errors.length, 1);
  assert.equal(errors[0].type, 'MESSAGE_TOO_LARGE');
  client.close();
});

test('v2 heartbeat is not fooled by streamed events on a dead uplink', (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
  const errors = [];
  const sockets = [];
  class FakeSocket {
    static OPEN = 1;
    readyState = 1;
    sent = [];
    closed = false;
    constructor() { sockets.push(this); }
    send(value) { this.sent.push(value); }
    close() { this.closed = true; }
  }
  const client = new v2.V2ConversationSocket({
    serverUrl: 'http://127.0.0.1:7345',
    WebSocketImpl: FakeSocket,
    heartbeatInterval: 1000,
    maxMissedHeartbeats: 3,
    onError: (error) => errors.push(error),
  });
  client.connect();
  const socket = sockets[0];
  socket.onopen();

  // The server keeps streaming conversation events, but never answers a ping —
  // the shape of a dead uplink under an alive downlink. Before the fix, every
  // inbound message reset the missed counter and this went undetected forever.
  for (let round = 0; round < 5; round++) {
    t.mock.timers.tick(1000);
    socket.onmessage({
      data: JSON.stringify({
        type: 'conversation.event',
        payload: { conversationId: 'c1', sequence: round + 1, eventId: `e${round}`, type: 'message.delta', time: '', payload: {} },
      }),
    });
  }

  assert.ok(socket.closed, 'socket must be closed after maxMissedHeartbeats unanswered pings');
  assert.equal(errors.filter((e) => e.type === 'HEARTBEAT_TIMEOUT').length, 1);
  client.close();
});

test('v2 heartbeat stays quiet while pings are answered', (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
  const errors = [];
  const sockets = [];
  class FakeSocket {
    static OPEN = 1;
    readyState = 1;
    sent = [];
    closed = false;
    constructor() { sockets.push(this); }
    send(value) { this.sent.push(value); }
    close() { this.closed = true; }
  }
  const client = new v2.V2ConversationSocket({
    serverUrl: 'http://127.0.0.1:7345',
    WebSocketImpl: FakeSocket,
    heartbeatInterval: 1000,
    maxMissedHeartbeats: 3,
    onError: (error) => errors.push(error),
  });
  client.connect();
  const socket = sockets[0];
  socket.onopen();

  for (let round = 0; round < 6; round++) {
    t.mock.timers.tick(1000);
    const last = JSON.parse(socket.sent[socket.sent.length - 1]);
    assert.equal(last.type, 'server.ping');
    // Answer the way the backend does: a server.result echoing the request id.
    socket.onmessage({ data: JSON.stringify({ id: last.id, type: 'server.result', payload: { pong: true } }) });
  }

  assert.equal(socket.closed, false);
  assert.equal(errors.length, 0);
  client.close();
});

test('main socket uses the single-argument WebSocket constructor', () => {
  // Regression guard for the retired RN-style three-argument form: the third
  // argument (header options) is ignored by Electron's WebSocket, so a header
  // -only auth future would silently break. Authentication must ride on the
  // URL built by buildV2WebSocketUrlWithOptions.
  const appSource = fs.readFileSync(path.join(__dirname, '..', '..', 'App.tsx'), 'utf8');
  const controllerSource = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'runtime', 'connectionController.ts'),
    'utf8',
  );
  assert.ok(
    controllerSource.includes('new WebSocket(url)'),
    'the connection controller must construct the socket with one URL argument',
  );
  assert.equal(appSource.includes('new WebSocket('), false, 'App.tsx must not own the WebSocket');
  assert.ok(
    !controllerSource.includes('undefined, options)'),
    'connect() must not pass a third WebSocket constructor argument',
  );
  assert.ok(
    !/new \(WebSocket as typeof WebSocket/.test(controllerSource),
    'connect() must not use the RN WebSocket constructor cast',
  );
  const connectStart = controllerSource.indexOf('const wsUrl = buildV2WebSocketUrlWithOptions');
  const tryStart = controllerSource.indexOf('try {', connectStart);
  const headerOptions = controllerSource.slice(connectStart, tryStart).match(/Authorization/);
  assert.equal(headerOptions, null, 'connect() must not build header-only auth options');
});

test('root app delegates connection lifecycle and global overlays', () => {
  const appSource = fs.readFileSync(path.join(__dirname, '..', '..', 'App.tsx'), 'utf8');
  assert.ok(appSource.includes('<ConnectionRuntimeEffects />'));
  assert.ok(appSource.includes('<AppOverlayHost />'));
  assert.equal(/const \[connection(State|Health)/.test(appSource), false);
  assert.equal(/<(PromptModal|ModelPickerModal|SkillPickerModal|ThreadInfoModal)\b/.test(appSource), false);
  assert.equal(appSource.includes('socketRef'), false);
  assert.equal(appSource.includes('reconnectTimerRef'), false);
  assert.equal(appSource.includes('healthProbeSeqRef'), false);
});

test('mobile navigation remains isolated from the root state component', () => {
  const appSource = fs.readFileSync(path.join(__dirname, '..', '..', 'App.tsx'), 'utf8');
  const navigatorSource = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'navigation', 'AppNavigator.tsx'),
    'utf8',
  );
  assert.equal(appSource.includes('<Stack.Screen'), false, 'App.tsx must not register screens directly');
  assert.ok(appSource.includes('<AppNavigator />'), 'App.tsx must render the isolated navigator');
  assert.equal(
    /<Stack\.Screen[^>]*>\s*\{/.test(navigatorSource),
    false,
    'navigator screens must use static component registration instead of render props',
  );
});

test('normalizes loopback server URLs to origin without /v1', () => {
  assert.equal(todex.normalizeServerUrl('http://localhost:7345/v2/ws'), 'http://127.0.0.1:7345');
  assert.equal(todex.normalizeServerUrl('ws://127.0.0.1:7345/path'), 'http://127.0.0.1:7345');
  assert.equal(todex.normalizeServerUrl('http://[::1]:7345'), 'http://127.0.0.1:7345');
});

test('rejects /v1 protocol and mismatched token origin', () => {
  const inspected = connectionProbe.inspectServerUrl('http://127.0.0.1:7345/v1/ws');
  assert.equal(inspected.error.code, 'protocol_mismatch');
  assert.match(inspected.error.userMessage, /\/v2/);
  assert.equal(connectionProbe.tokenMatchesOrigin('http://127.0.0.1:7345', 'http://localhost:7345'), true);
  assert.equal(connectionProbe.tokenMatchesOrigin('http://127.0.0.1:7345', 'http://10.0.0.2:7345'), false);
});

test('reconnect delay grows from 2s to 30s', () => {
  assert.equal(connectionProbe.nextReconnectDelayMs(0), 2000);
  assert.equal(connectionProbe.nextReconnectDelayMs(1), 4000);
  assert.equal(connectionProbe.nextReconnectDelayMs(8), 30000);
  assert.equal(connectionProbe.nextReconnectDelayMs(99), 30000);
});

test('v2 prompt JSON includes skill resourceIds without file contents', async () => {
  const bodies = [];
  const client = new v2.V2ApiClient({
    serverUrl: 'http://127.0.0.1:7345',
    fetchImpl: async (_url, init) => {
      bodies.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ conversationId: 'c1', turnId: 't1' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
  });
  await client.prompt('c1', 'use the skill', undefined, [{ resourceId: 'skill_abc', name: 'build' }]);
  assert.deepEqual(bodies[0], {
    text: 'use the skill',
    skills: [{ resourceId: 'skill_abc', name: 'build' }],
  });
  assert.equal(JSON.stringify(bodies[0]).includes('/Users'), false);
});

test('provider display names keep Cloud Code out of conversation agents', () => {
  assert.equal(v2.providerDisplayName('codex'), 'Codex CLI');
  assert.equal(v2.providerDisplayName('acp'), 'ACP');
  assert.equal(v2.providerDisplayName('claude-code'), 'Claude Code');
  assert.equal(v2.providerDisplayName('grok-build'), 'Grok Build');
  assert.equal(Object.values(v2.PROVIDER_DISPLAY_NAMES).includes('Cloud Code'), false);
});

test('ACP permission options preserve order and exact option ids', () => {
  const request = todex.classifyPendingRequest({
    type: 'conversation.permission.request',
    payload: {
      requestId: 'perm-1',
      permissionId: 'perm-1',
      conversationId: 'conv-v2',
      options: [
        { optionId: 'reject-always', name: 'Always reject', kind: 'reject_always' },
        { optionId: 'allow-always', name: 'Always allow', kind: 'allow_always' },
        { optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' },
        { optionId: 'reject-once', name: 'Reject once', kind: 'reject_once' },
      ],
    },
  });
  const options = todex.permissionOptions(request);
  assert.deepEqual(options.map((option) => option.optionId), [
    'reject-always', 'allow-always', 'allow-once', 'reject-once',
  ]);
  assert.deepEqual(todex.permissionDecision(options[1]), {
    outcome: 'allow_always',
    optionId: 'allow-always',
  });
});

test('permission actions retain legacy fallback but malformed options cannot widen access', () => {
  const legacy = todex.classifyPendingRequest({
    type: 'conversation.permission.request',
    payload: { requestId: 'legacy', permissionId: 'legacy' },
  });
  assert.deepEqual(todex.permissionActions(legacy), [true, false]);

  const malformed = todex.classifyPendingRequest({
    type: 'conversation.permission.request',
    payload: {
      requestId: 'malformed',
      permissionId: 'malformed',
      options: [
        { optionId: 'same', name: 'Allow', kind: 'allow_always' },
        { optionId: 'same', name: 'Reject', kind: 'reject_once' },
      ],
    },
  });
  assert.deepEqual(todex.permissionActions(malformed), [false]);
});

test('connection failure labels are Chinese and classified', () => {
  assert.equal(connectionError.connectionFailureLabel('protocol_mismatch'), '协议已废弃（/v1）');
  assert.equal(connectionError.ConnectionError.authenticationFailed(401).retryable, false);
});
