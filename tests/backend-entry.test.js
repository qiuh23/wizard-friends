import test from 'node:test';
import assert from 'node:assert/strict';
import { backendStorage, entryURL, gameLobbyURL, invitationRedirect, invitationURL, loadRuntimeConfig, normalizeRuntimeConfig, parseRoomCode, readInvitation, relayOrigin } from '../src/backend-entry.js';
import { uuidV4 } from '../src/uuid.js';
import { relayURL } from '../src/relay-socket.js';

const origin = 'http://115.29.188.62:8081';
const config = { siteEdition: 'cn', backendId: 'aliyun', relayOrigin: '', backends: [
  { id: 'aliyun', origin, enabled: true },
] };

test('ordinary lobby navigation follows the current line without invitation or credential parameters', () => {
  assert.equal(gameLobbyURL('aliyun'), 'https://magical-athlete-online.cn/');
  assert.equal(gameLobbyURL('cloudflare'), 'https://magical-athlete.qiuh23.workers.dev/lobby/');
  assert.equal(gameLobbyURL('untrusted'), null);
  assert.equal(gameLobbyURL('constructor'), null);
});
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
  assert.equal(entryURL('aliyun', {}, normalized), `${origin}/`);
  assert.equal(entryURL('https://evil.example', {}, normalized), null);
  assert.equal(entryURL('cloudflare', { room: 'ABCDEFGH', watch: true }, normalized), null);
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
  assert.throws(() => invitationRedirect(location, true, normalized), /此邀请不属于当前站点/);
  assert.throws(() => invitationRedirect(location, false, normalized), /此邀请不属于当前站点/);
  assert.equal(invitationRedirect(new URL(`${origin}/?room=A-ABCDEFGH`), false, normalized), null);
});

test('explicit invitation server and watch are preserved; ambiguous invitations never enter a different pool', () => {
  assert.deepEqual(readInvitation('?room=ABCDEFGH&server=aliyun&game=wizard&watch=1', 'cloudflare'), { backendId: 'aliyun', room: 'ABCDEFGH', watch: true });
  assert.deepEqual(readInvitation('?room=ABCDEFGH', 'cloudflare'), { backendId: 'cloudflare', room: 'ABCDEFGH', watch: false });
  assert.throws(() => invitationRedirect(new URL(`${origin}/?room=ABCDEFGH&server=cloudflare&watch=1&token=private&next=https://evil.test#secret`), false, config), /此邀请不属于当前站点/);
  for (const search of [
    '?room=A-ABCDEFGH&server=cloudflare', '?room=ABCDEFGH&server=unknown',
    '?room=ABCDEFGH&room=HGFEDCBA', '?room=ABCDEFGH&watch=1&watch=0',
    '?room=ABCDEFGH&server=aliyun&server=cloudflare', '?room=ABCDEFGH&game=athlete',
    '?room=ABCDEFGH&game=wizard&game=wizard', '?room=ABCDEFGH&watch=yes', '?room=bad',
  ]) assert.throws(() => invitationRedirect(new URL(`${origin}/${search}`), false, config), /邀请/);
  assert.throws(() => invitationRedirect(new URL('https://wizard-friends.qiuh23.workers.dev/?room=A-ABCDEFGH&watch=1'), false, { ...config, backendId: 'cloudflare' }), /此邀请不属于当前站点/);
  assert.throws(() => invitationRedirect(new URL('https://wizard-friends.qiuh23.workers.dev/?room=A-ABCDEFGH'), true, { ...config, backendId: 'cloudflare' }), /此邀请不属于当前站点/);
});
test('runtime same-origin relay overrides fixed Cloudflare build configuration without an external probe', async () => {
  const location = new URL(`${origin}/`);
  const calls = [];
  await loadRuntimeConfig({ location, fetcher: async (url, options) => { calls.push(url.href); assert.equal(options.cache, 'no-store'); assert.equal(options.redirect, 'error'); assert.equal(options.credentials, 'same-origin'); assert.ok(options.signal); return Response.json(config); } });
  assert.deepEqual(calls, [`${origin}/runtime-config.json`]);
  assert.equal(relayOrigin('https://wizard-friends.qiuh23.workers.dev', location), origin);
  assert.equal(relayURL('/api/presence', relayOrigin('https://cloudflare.test', location)), 'ws://115.29.188.62:8081/api/presence');
  const https = new URL('https://wizard-friends.qiuh23.workers.dev');
  assert.equal(relayOrigin('http://115.29.188.62:8081', https), https.origin);
  await assert.rejects(loadRuntimeConfig({ location, fetcher: async () => new Response('', { status: 503 }) }), /配置暂不可用/);
  await loadRuntimeConfig({ location: https, fetcher: async () => Response.json({ siteEdition:'global', backendId:'cloudflare', relayOrigin:'', backends:[{id:'cloudflare',origin:'',enabled:true}] }) });
  assert.equal(relayOrigin('http://115.29.188.62:8081', https), https.origin);
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
