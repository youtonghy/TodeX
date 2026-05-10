const assert = require('node:assert/strict');

const { extractThreadIdFromEvent, normalizeThreadId } = require('/tmp/todex-protocol-check/todex.js');

const cases = [
  [
    {
      type: 'codex.control.response',
      payload: {
        data: {
          requestId: 'thread-start-1',
          result: { thread: { id: 'thread_nested_1' } },
        },
      },
    },
    'thread_nested_1',
  ],
  [
    {
      type: 'codex.control.response',
      payload: {
        requestId: 'thread-start-2',
        result: { id: 'thread_result_id' },
      },
    },
    'thread_result_id',
  ],
  [
    {
      type: 'codex.thread.started',
      codex_thread_id: 'thread_event_id',
      payload: {},
    },
    'thread_event_id',
  ],
  [
    {
      type: 'codex.thread.started',
      payload: { thread_id: 'thread_payload_id' },
    },
    'thread_payload_id',
  ],
];

for (const [event, expected] of cases) {
  assert.equal(extractThreadIdFromEvent(event), expected);
}

assert.equal(normalizeThreadId(' thread_1 '), 'thread_1');

console.log('protocol thread id extraction ok');
