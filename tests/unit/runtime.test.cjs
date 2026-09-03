const assert = require('node:assert/strict');
const { test } = require('node:test');
const path = require('node:path');

const compiledDir = path.join(__dirname, '..', '..', 'dist', 'unit');
const { ExternalStore, KeyedExternalStore, RuntimeTransaction } = require(path.join(compiledDir, 'runtime', 'externalStore.js'));
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
