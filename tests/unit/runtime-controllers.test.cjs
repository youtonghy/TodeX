const assert = require('node:assert/strict');
const { test } = require('node:test');
const path = require('node:path');

const compiledDir = path.join(__dirname, '..', '..', 'dist', 'unit');
const { ConnectionController } = require(path.join(compiledDir, 'runtime', 'connectionController.js'));
const { AppOverlayStore } = require(path.join(compiledDir, 'runtime', 'appOverlayStore.js'));
const { ConnectionError } = require(path.join(compiledDir, 'lib', 'connectionError.js'));

const settings = {
  serverUrl: 'http://127.0.0.1:7345',
  authToken: 'secret',
  tenantId: 'local',
  encryptionProtocol: 'none',
  encryptionPublicKey: '',
  defaultWorkspacePath: '/tmp',
  defaultModel: 'gpt-5.5',
  defaultReasoningEffort: 'medium',
  approvalPolicy: 'on-request',
  approvalsReviewer: 'user',
  sandboxMode: 'workspace-write',
};

function successfulProbe() {
  return {
    ok: true,
    origin: settings.serverUrl,
    version: { name: 'todex-agentd', version: '1.0.0' },
    providers: [],
    error: null,
    code: '',
  };
}

function handlers(overrides = {}) {
  return {
    onProbe: () => undefined,
    onOpen: () => undefined,
    onFrame: () => undefined,
    onResetTransport: () => undefined,
    onError: () => undefined,
    onClearError: () => undefined,
    ...overrides,
  };
}

class FakeSocket {
  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.onopen = null;
    this.onmessage = null;
    this.onerror = null;
    this.onclose = null;
    this.sent = [];
    this.closed = false;
  }

  send(value) {
    this.sent.push(value);
  }

  close() {
    this.closed = true;
    this.readyState = 3;
  }
}

const flushPromises = () => new Promise((resolve) => setImmediate(resolve));

test('connection controller owns the socket, sends frames, and suppresses duplicate subscriptions', async () => {
  const sockets = [];
  const events = [];
  const controller = new ConnectionController({
    createSocket: (url) => {
      const socket = new FakeSocket(url);
      sockets.push(socket);
      return socket;
    },
    probeConnection: async () => successfulProbe(),
    fetchImpl: async () => new Response('{}', { status: 200 }),
  });
  controller.bindHandlers(handlers({
    onProbe: () => events.push('probe'),
    onOpen: () => events.push('open'),
    onFrame: (frame) => events.push(frame.data),
  }));
  controller.configure(settings);
  controller.connect();
  assert.equal(controller.state.getSnapshot(), 'connecting');
  await flushPromises();

  assert.equal(sockets.length, 1);
  const socket = sockets[0];
  assert.match(socket.url, /^ws:\/\/127\.0\.0\.1:7345\/v2\/ws\?/);
  socket.readyState = 1;
  socket.onopen();
  assert.equal(controller.state.getSnapshot(), 'open');
  assert.deepEqual(events.slice(0, 2), ['probe', 'open']);

  assert.ok(controller.send({ id: 'one', type: 'server.ping', payload: {} }));
  assert.equal(controller.subscribeConversation('conversation-1'), true);
  const sentCount = socket.sent.length;
  assert.equal(controller.subscribeConversation('conversation-1'), true);
  assert.equal(socket.sent.length, sentCount);
  socket.onmessage({ data: '{"type":"server.result"}' });
  assert.equal(events.at(-1), '{"type":"server.result"}');

  controller.disconnect(true);
  assert.equal(controller.state.getSnapshot(), 'closed');
  assert.equal(socket.closed, true);
});

test('connection controller ignores a probe that resolves after disconnect', async () => {
  let resolveProbe;
  const sockets = [];
  const controller = new ConnectionController({
    createSocket: (url) => {
      const socket = new FakeSocket(url);
      sockets.push(socket);
      return socket;
    },
    probeConnection: () => new Promise((resolve) => { resolveProbe = resolve; }),
  });
  controller.bindHandlers(handlers());
  controller.configure(settings);
  controller.connect();
  controller.disconnect(true);
  resolveProbe(successfulProbe());
  await flushPromises();

  assert.equal(sockets.length, 0);
  assert.equal(controller.state.getSnapshot(), 'closed');
});

test('manual disconnect cancels an automatic reconnect', async () => {
  const timers = [];
  let probeCount = 0;
  const controller = new ConnectionController({
    probeConnection: async () => {
      probeCount += 1;
      return {
        ...successfulProbe(),
        ok: false,
        error: ConnectionError.unreachable('offline'),
        code: 'backend_unreachable',
      };
    },
    fetchImpl: async () => new Response('{}', { status: 200 }),
    setTimeoutImpl: (callback, delay) => {
      const timer = { callback, delay, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimeoutImpl: (timer) => { timer.cleared = true; },
    setIntervalImpl: () => ({ interval: true }),
    clearIntervalImpl: () => undefined,
  });
  controller.bindHandlers(handlers());
  controller.start(settings, true);
  await flushPromises();

  const reconnect = timers.find((timer) => timer.delay === 2000);
  assert.ok(reconnect);
  assert.equal(controller.state.getSnapshot(), 'error');
  controller.disconnect(true);
  assert.equal(reconnect.cleared, true);
  reconnect.callback();
  await flushPromises();
  assert.equal(probeCount, 1);
  controller.dispose();
});

test('disposing the controller allows a strict-mode style restart', async () => {
  let probeCount = 0;
  const controller = new ConnectionController({
    probeConnection: async () => {
      probeCount += 1;
      return successfulProbe();
    },
    fetchImpl: async () => new Response('{}', { status: 200 }),
    createSocket: (url) => new FakeSocket(url),
    setIntervalImpl: () => ({ interval: true }),
    clearIntervalImpl: () => undefined,
  });
  controller.bindHandlers(handlers());

  controller.start(settings, true);
  await flushPromises();
  controller.dispose();
  controller.start(settings, true);
  await flushPromises();

  assert.equal(probeCount, 2);
  controller.dispose();
});

test('a non-retryable connection failure does not schedule reconnect', async () => {
  const timers = [];
  const controller = new ConnectionController({
    probeConnection: async () => ({
      ...successfulProbe(),
      ok: false,
      error: ConnectionError.invalidServerUrl('invalid'),
      code: 'invalid_server_url',
    }),
    fetchImpl: async () => new Response('{}', { status: 200 }),
    setTimeoutImpl: (callback, delay) => {
      const timer = { callback, delay, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimeoutImpl: (timer) => { timer.cleared = true; },
    setIntervalImpl: () => ({ interval: true }),
    clearIntervalImpl: () => undefined,
  });
  controller.bindHandlers(handlers());
  controller.start(settings, true);
  await flushPromises();

  assert.equal(controller.state.getSnapshot(), 'error');
  assert.equal(timers.some((timer) => timer.delay === 2000), false);
  controller.dispose();
});

test('health updates do not notify connection-state subscribers', async () => {
  let now = 100;
  let stateNotifications = 0;
  let healthNotifications = 0;
  const controller = new ConnectionController({
    fetchImpl: async () => new Response('{}', { status: 200 }),
    now: () => ++now,
    setIntervalImpl: () => ({ interval: true }),
    clearIntervalImpl: () => undefined,
  });
  controller.state.subscribe(() => { stateNotifications += 1; });
  controller.health.subscribe(() => { healthNotifications += 1; });
  controller.bindHandlers(handlers());
  controller.start(settings, false);
  await flushPromises();

  assert.equal(stateNotifications, 0);
  assert.ok(healthNotifications >= 2);
  assert.equal(controller.health.getSnapshot().status, 'online');
  assert.ok(controller.health.getSnapshot().latencyMs > 0);
  controller.dispose();
});

test('overlay store rejects stale closes and stale skill responses', () => {
  const overlays = new AppOverlayStore();
  const firstId = overlays.openModelPicker({ target: 'workspace', conversationId: 'c1' });
  const secondId = overlays.openModelPicker({ target: 'workspace', conversationId: 'c2' });
  overlays.close('modelPicker', firstId);
  assert.equal(overlays.snapshot.getSnapshot().modelPicker.id, secondId);

  overlays.openSkillPicker({
    conversationId: 'c1',
    requestId: 'request-1',
    status: 'loading',
    error: '',
    items: [],
  });
  overlays.openSkillPicker({
    conversationId: 'c2',
    requestId: 'request-2',
    status: 'loading',
    error: '',
    items: [],
  });
  overlays.updateSkillRequest('request-1', { status: 'error', error: 'stale' });
  assert.equal(overlays.snapshot.getSnapshot().skillPicker.value.status, 'loading');
  overlays.updateSkillRequest('request-2', { status: 'ready', items: [{ id: 'skill' }] });
  assert.equal(overlays.snapshot.getSnapshot().skillPicker.value.status, 'ready');
});

test('overlay store replaces model picker with manual prompt atomically', () => {
  const overlays = new AppOverlayStore();
  const pickerId = overlays.openModelPicker({ target: 'workspace', conversationId: 'c1' });
  let notifications = 0;
  overlays.snapshot.subscribe(() => { notifications += 1; });
  overlays.replaceModelPickerWithCommand(pickerId, {
    conversationId: 'c1',
    initialValue: 'gpt-5.5 high',
  });

  const snapshot = overlays.snapshot.getSnapshot();
  assert.equal(notifications, 1);
  assert.equal(snapshot.modelPicker, null);
  assert.equal(snapshot.modelCommand.value.initialValue, 'gpt-5.5 high');
});
