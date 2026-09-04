const assert = require('node:assert/strict');
const { test } = require('node:test');
const path = require('node:path');

const compiledDir = path.join(__dirname, '..', '..', 'dist', 'unit');
const { ExternalStore, KeyedExternalStore, RuntimeActionRegistry, RuntimeTransaction } = require(path.join(compiledDir, 'runtime', 'externalStore.js'));
const { buildGitDiffViewModel, retainTerminalOutput } = require(path.join(compiledDir, 'lib', 'outputModels.js'));

test('keyed store keeps snapshots stable and only notifies changed keys', () => {
  const store = new KeyedExternalStore();
  const notifications = [];
  store.subscribe(() => notifications.push('all'));
  store.subscribeKey('a', () => notifications.push('a'));
  store.subscribeKey('b', () => notifications.push('b'));

  const value = { count: 1 };
  store.set('a', value);
  const snapshot = store.getAllSnapshot();
  store.set('a', value);

  assert.equal(store.getAllSnapshot(), snapshot);
  assert.deepEqual(notifications, ['all', 'a']);
  assert.equal(store.getSnapshot('a'), value);
  assert.equal(store.getSnapshot('missing'), null);
});

test('keyed store supports prototype-like keys and coalesces duplicate listeners', () => {
  const store = new KeyedExternalStore();
  let notifications = 0;
  const listener = () => { notifications += 1; };
  store.subscribe(listener);
  store.subscribeKey('toString', listener);
  store.set('toString', 7);
  assert.equal(store.getSnapshot('toString'), 7);
  assert.equal(store.getSnapshot('constructor'), null);
  assert.equal(notifications, 1);
  store.delete('toString');
  assert.equal(store.getSnapshot('toString'), null);
});

test('runtime transaction coalesces shared listeners across stores', () => {
  const transaction = new RuntimeTransaction();
  const left = new KeyedExternalStore(transaction);
  const right = new KeyedExternalStore(transaction);
  let notifications = 0;
  const listener = () => { notifications += 1; };
  left.subscribe(listener);
  right.subscribe(listener);

  transaction.run(() => {
    left.set('one', 1);
    right.set('two', 2);
  });

  assert.equal(notifications, 1);
});

test('value store ignores Object.is no-op updates', () => {
  const store = new ExternalStore('idle');
  let notifications = 0;
  store.subscribe(() => { notifications += 1; });
  store.set('idle');
  store.update(() => 'open');
  assert.equal(store.getSnapshot(), 'open');
  assert.equal(notifications, 1);
});

test('runtime transaction drains listeners after an error and remains reusable', () => {
  const transaction = new RuntimeTransaction();
  const store = new ExternalStore(0, transaction);
  const notifications = [];
  store.subscribe(() => {
    notifications.push('throws');
    throw new Error('listener failed');
  });
  store.subscribe(() => notifications.push('continues'));

  assert.throws(() => store.set(1), /listener failed/);
  assert.deepEqual(notifications, ['throws', 'continues']);
  assert.throws(() => store.set(2), /listener failed/);
  assert.equal(store.getSnapshot(), 2);
});

test('runtime transaction preserves undefined thrown by an operation', () => {
  const transaction = new RuntimeTransaction();
  assert.throws(
    () => transaction.run(() => { throw undefined; }),
    (error) => error === undefined,
  );
});

test('runtime action facades stay stable while dispatching to the latest implementation', () => {
  const registry = new RuntimeActionRegistry();
  const actions = registry.get('chat');
  const submit = actions.submit;
  registry.bind('chat', { submit: (value) => `first:${value}` });
  assert.equal(submit('one'), 'first:one');
  registry.bind('chat', { submit: (value) => `second:${value}` });
  assert.equal(actions.submit, submit);
  assert.equal(submit('two'), 'second:two');
});

test('runtime action facades remain callable when spread into component props', () => {
  const registry = new RuntimeActionRegistry();
  const actions = registry.get('workspaces');
  registry.bind('workspaces', {
    selectWorkspace: (workspaceId) => `first:${workspaceId}`,
    openSettings: () => 'settings',
  });

  const props = { ...actions };
  assert.deepEqual(Object.keys(props), ['selectWorkspace', 'openSettings']);
  assert.equal(props.selectWorkspace('workspace-1'), 'first:workspace-1');
  assert.equal(props.openSettings(), 'settings');

  registry.bind('workspaces', {
    selectWorkspace: (workspaceId) => `second:${workspaceId}`,
  });
  assert.equal(props.selectWorkspace('workspace-2'), 'second:workspace-2');
});

test('terminal output retention applies entry and character limits from the newest entries', () => {
  const entries = [
    { id: '1', text: '1234' },
    { id: '2', text: '5678' },
    { id: '3', text: '90' },
  ];
  assert.deepEqual(retainTerminalOutput(entries, 2, 20), {
    entries: [entries[1], entries[2]],
    truncated: true,
  });
  assert.deepEqual(retainTerminalOutput(entries, 10, 6), {
    entries: [entries[1], entries[2]],
    truncated: true,
  });
});

test('git diff view model caps displayed rows while counting the complete diff', () => {
  const diff = [
    'diff --git a/a b/a',
    '--- a/a',
    '+++ b/a',
    '@@ -1 +1 @@',
    '-old',
    '+new',
    ' context',
  ].join('\n');
  const model = buildGitDiffViewModel(diff, 5, 1024);

  assert.equal(model.lines.length, 5);
  assert.equal(model.totalLines, 7);
  assert.equal(model.additions, 1);
  assert.equal(model.deletions, 1);
  assert.equal(model.truncated, true);
  assert.deepEqual(model.lines.map((line) => line.kind), ['meta', 'meta', 'meta', 'hunk', 'deletion']);
});

test('git diff view model preserves trailing empty lines', () => {
  const model = buildGitDiffViewModel('+one\n');
  assert.equal(model.totalLines, 2);
  assert.equal(model.lines[1].text, '');
});
