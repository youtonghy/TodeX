const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { ed25519 } = require('@noble/curves/ed25519.js');
const deviceAuth = require('../../dist/unit/lib/deviceAuth.js');

const fixture = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, '../../../TodeX_backend/tests/fixtures/device-auth-v1.json'),
    'utf8',
  ),
);

function b64url(value) {
  return Buffer.from(value, 'base64').toString('base64url');
}

test('device auth signature matches the cross-language fixture', () => {
  const identity = deviceAuth.deviceIdentityFromSecret(fixture.deviceSeed);
  assert.equal(identity.publicKey, fixture.devicePublicKey);
  assert.equal(identity.deviceId, fixture.deviceId);

  const canonical = deviceAuth.canonicalQuery(fixture.rawQuery);
  assert.equal(canonical, fixture.canonicalQuery);

  const payload = deviceAuth.signedPayload(
    fixture.deviceId,
    fixture.method,
    fixture.path,
    canonical,
    fixture.timestamp,
    fixture.nonce,
    Buffer.from(fixture.body, 'utf8'),
  );
  assert.equal(Buffer.from(payload).toString('base64url'), fixture.payload);

  const signature = ed25519.sign(payload, Buffer.from(fixture.deviceSeed, 'base64url'));
  assert.equal(b64url(signature), fixture.signature);
});

test('deviceAuthHeaders produce verifiable credentials bound to the request', () => {
  const identity = deviceAuth.deviceIdentityFromSecret(fixture.deviceSeed);
  const headers = deviceAuth.deviceAuthHeaders(identity, 'POST', '/v2/kanban/tasks?x=1', Buffer.from('{"tasks":[]}'));
  assert.equal(headers['x-todex-device-id'], fixture.deviceId);
  assert.ok(headers['x-todex-auth-ts']);
  assert.ok(headers['x-todex-auth-nonce']);
  const payload = deviceAuth.signedPayload(
    identity.deviceId,
    'POST',
    '/v2/kanban/tasks',
    'x=1',
    headers['x-todex-auth-ts'],
    headers['x-todex-auth-nonce'],
    Buffer.from('{"tasks":[]}'),
  );
  const signature = Buffer.from(headers['x-todex-auth-sig'], 'base64url');
  assert.ok(ed25519.verify(signature, payload, Buffer.from(fixture.devicePublicKey, 'base64url')));
});

test('deviceAuthQuery drops auth keys from the signed canonical query', () => {
  const identity = deviceAuth.deviceIdentityFromSecret(fixture.deviceSeed);
  const query = deviceAuth.deviceAuthQuery(identity, '/v2/ws?enc=none&access_token=leak');
  assert.ok(query.startsWith(`device_id=${fixture.deviceId}&auth_ts=`));
  assert.ok(query.includes('&auth_nonce='));
  assert.ok(query.includes('&auth_sig='));
  // access_token is not an auth key; it stays in the canonical query.
  assert.equal(deviceAuth.canonicalQuery('enc=none&access_token=leak'), 'access_token=leak&enc=none');
});

test('deviceIdentityFromSecret rejects malformed secrets', () => {
  assert.equal(deviceAuth.deviceIdentityFromSecret(''), null);
  assert.equal(deviceAuth.deviceIdentityFromSecret('not-base64!!!'), null);
  assert.equal(deviceAuth.deviceIdentityFromSecret(Buffer.alloc(8).toString('base64url')), null);
});
