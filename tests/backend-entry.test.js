import test from 'node:test';
import assert from 'node:assert/strict';
import { backendStorage, entryURL, invitationRedirect, invitationURL, loadRuntimeConfig, normalizeRuntimeConfig, parseRoomCode, relayOrigin } from '../src/backend-entry.js';
import { uuidV4 } from '../src/uuid.js';
import { relayURL } from '../src/relay-socket.js';

const origin = 'http://115.29.188.62:8081';
const config = { backendId: 'aliyun', relayOrigin: '', backends: [
  { id: 'cloudflare', origin: 'https://wizard-friends.qiuh23.workers.dev', enabled: true },
  { id: 'aliyun', origin, enabled: false },
] };
test('HTTP UUID fallback produces cryptographic RFC 4122 version 4 identifiers', () => {
  let calls = 0;
  const id = uuidV4({ getRandomValues(bytes) { calls++; bytes.fill(255); return bytes; } });
  assert.equal(calls, 1);
  assert.equal(id, 'ffffffff-ffff-4fff-bfff-ffffffffffff');
  assert.equal(uuidV4({ randomUUID: () => 'native' }), 'native');
  assert.throws(() => uuidV4({}), /安全随机数/);
  for (let i = 0; i < 20; i++) assert.match(uuidV4({ getRandomValues: bytes => crypto.getRandomValues(bytes) }), /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
});
test('only trusted runtime entries supply navigation addresses and disabled entries do not navigate', () => {
  const normalized = normalizeRuntimeConfig(config, origin);
  assert.equal(entryURL('aliyun', {}, normalized), null);
  assert.equal(entryURL('https://evil.example', {}, normalized), null);
  assert.equal(entryURL('cloudflare', { room: 'ABCDEFGH', watch: true }, normalized), 'https://wizard-friends.qiuh23.workers.dev/?room=C-ABCDEFGH&watch=1');
  for (const address of ['javascript:alert(1)', 'https://user:secret@example.test', 'https://example.test/?token=secret', 'https://example.test/path', 'https://example.test/#secret']) {
    assert.throws(() => normalizeRuntimeConfig({ ...config, backends: [{ id: 'aliyun', origin: address, enabled: true }] }, origin));
  }
  assert.throws(() => normalizeRuntimeConfig({ ...config, relayOrigin: 'https://external.test' }, origin));
});
test('public invitation includes backend and port but no caller query, hash or credential', () => {
  const location = new URL(`${origin}/?token=secret&relay=https://evil.test#secret`);
  assert.equal(invitationURL('ABCDEFGH', true, location, 'aliyun'), `${origin}/?room=A-ABCDEFGH&watch=1`);
  assert.deepEqual(parseRoomCode(' a-abcdefgh ', 'cloudflare'), { backendId: 'aliyun', room: 'ABCDEFGH' });
  assert.deepEqual(parseRoomCode('C-ABCDEFGH', 'aliyun'), { backendId: 'cloudflare', room: 'ABCDEFGH' });
  assert.deepEqual(parseRoomCode('ABCDEFGH', 'cloudflare'), { backendId: 'cloudflare', room: 'ABCDEFGH' });
  assert.equal(parseRoomCode('https://evil.test/?room=ABCDEFGH'), null);
  assert.equal(parseRoomCode('A-ABCDEFGH?token=secret'), null);
});
test('a foreign invitation never switches a recovering current game to another backend', () => {
  const normalized = normalizeRuntimeConfig(config, origin);
  const location = new URL(`${origin}/?room=C-ABCDEFGH&watch=1&token=secret#secret`);
  assert.equal(invitationRedirect(location, true, normalized), null);
  assert.equal(invitationRedirect(location, false, normalized), 'https://wizard-friends.qiuh23.workers.dev/?room=C-ABCDEFGH&watch=1');
  assert.equal(invitationRedirect(new URL(`${origin}/?room=A-ABCDEFGH`), false, normalized), null);
});
test('runtime same-origin relay overrides fixed Cloudflare build configuration without an external probe', async () => {
  const location = new URL(`${origin}/`);
  const calls = [];
  await loadRuntimeConfig({ location, fetcher: async url => { calls.push(url.href); return Response.json(config); } });
  assert.deepEqual(calls, [`${origin}/runtime-config.json`]);
  assert.equal(relayOrigin('https://wizard-friends.qiuh23.workers.dev', location), origin);
  assert.equal(relayURL('/api/presence', relayOrigin('https://cloudflare.test', location)), 'ws://115.29.188.62:8081/api/presence');
  const https = new URL('https://wizard-friends.qiuh23.workers.dev');
  assert.equal(relayOrigin('http://115.29.188.62:8081', https), https.origin);
  await assert.rejects(loadRuntimeConfig({ location, fetcher: async () => new Response('', { status: 503 }) }), /配置暂不可用/);
  await loadRuntimeConfig({ location: https, fetcher: async () => Response.json({ ...config, backendId: 'cloudflare', relayOrigin: null }) });
  assert.throws(() => relayOrigin('http://115.29.188.62:8081', https), /协议不兼容/);
});
test('origin-local pool scopes retain existing Cloudflare credentials without sharing Aliyun identities', () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  const cloudflare = backendStorage(storage, 'cloudflare'), aliyun = backendStorage(storage, 'aliyun');
  cloudflare.setItem('wizard-player-token', 'old-token');
  assert.equal(values.get('wizard-player-token'), 'old-token');
  assert.equal(aliyun.getItem('wizard-player-token'), undefined);
  aliyun.setItem('wizard-player-token', 'new-token');
  assert.equal(cloudflare.getItem('wizard-player-token'), 'old-token');
  aliyun.removeItem('wizard-player-token');
  assert.equal(cloudflare.getItem('wizard-player-token'), 'old-token');
});
