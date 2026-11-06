import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { exactOrigin, renderSite, siteConfig } from '../scripts/deploy/site-config.mjs';
import { probe, transportFailure } from '../scripts/deploy/probe.mjs';
import { exactAllowedOrigins, entryURL, invitationRedirect, invitationURL, normalizeRuntimeConfig, relayOrigin, loadRuntimeConfig } from '../src/backend-entry.js';
import { relayURL } from '../src/relay-socket.js';

const domestic = 'https://wizard.magical-athlete-online.cn';
const legacy = 'http://115.29.188.62:8081';
const cloudflare = 'https://wizard-friends.qiuh23.workers.dev';
const revision = 'a'.repeat(40);
const runtime = { siteEdition:'cn', backendId: 'aliyun', relayOrigin: '', backends: [{ id: 'aliyun', origin: domestic, enabled: true }] };

test('Wizard site supports exact HTTPS on shared 443 and preserves its independent legacy listener', () => {
  const config = siteConfig({ origin: domestic, legacyOrigin: legacy });
  assert.equal(config.publicPort, 443); assert.equal(config.port, 3002);
  const text = renderSite(config);
  assert.match(text, /listen 443 ssl;/); assert.match(text, /server_name wizard\.magical-athlete-online\.cn;/);
  assert.match(text, /listen 8081;/); assert.match(text, /proxy_pass http:\/\/127\.0\.0\.1:3002;/);
  assert.match(text, /location \^~ \/\.well-known\/acme-challenge\//);
  assert.match(text, /proxy_set_header Origin \$http_origin;/);
  assert.match(text, /proxy_set_header Host \$http_host;/);
  assert.doesNotMatch(text, /includeSubDomains|Strict-Transport-Security|listen 8080|127\.0\.0\.1:300[01]/);
  const http = renderSite(siteConfig({ origin: legacy }));
  assert.match(http, /listen 8081;/); assert.doesNotMatch(http, /ssl_certificate|listen 80;/);
  for (const value of ['https://wizard.magical-athlete-online.cn/', 'https://user:secret@example.com', 'https://example.com?token=x', 'https://example.com/#x', 'http://115.29.188.62', 'https://115.29.188.62', 'https://example.com:8443']) assert.throws(() => siteConfig({ origin: value }));
  for (const port of ['3000', '3001', '8080', '80', '65536', '3002;evil']) assert.throws(() => siteConfig({ origin: domestic, port }));
  assert.throws(() => siteConfig({ origin: domestic, publicPort: '8081' }));
  assert.throws(() => siteConfig({ origin: domestic, legacyOrigin: 'http://115.29.188.62:8080' }));
  assert.throws(() => exactOrigin('https://example.com/path'));
});

test('offline HTTPS preparation writes a review bundle and never overwrites existing output', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'wizard-https-review-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const target = join(directory, 'review');
  const run = () => spawnSync(process.execPath, ['scripts/deploy/prepare-https.mjs', target], { encoding: 'utf8' });
  assert.equal(run().status, 0);
  assert.match(await readFile(join(target, 'server.env.patch'), 'utf8'), /PUBLIC_ORIGIN=https:\/\/wizard\.magical-athlete-online\.cn/);
  assert.match(await readFile(join(target, 'server.env.patch'), 'utf8'), /ALLOWED_ORIGINS=http:\/\/115\.29\.188\.62:8081/);
  assert.deepEqual(JSON.parse(await readFile(join(target, 'runtime-config.cloudflare.json'), 'utf8')).backends, [{id:'cloudflare',origin:'',enabled:true}]);
  const original = await readFile(join(target, 'wizard-friends.nginx.conf'), 'utf8');
  assert.notEqual(run().status, 0);
  assert.equal(await readFile(join(target, 'wizard-friends.nginx.conf'), 'utf8'), original);
});

test('HTTPS invitations retain pool, room, watch; old-origin sharing and recovery remain available', async () => {
  const config = normalizeRuntimeConfig(runtime, domestic);
  const location = new URL(`${domestic}/?room=A-ABCDEFGH&watch=1&token=private&next=https://evil.test#private`);
  assert.equal(invitationURL('ABCDEFGH', true, location, 'aliyun'), `${domestic}/?room=A-ABCDEFGH&watch=1`);
  assert.equal(invitationURL('ABCDEFGH', false, new URL(`${legacy}/?token=private`), 'aliyun'), `${legacy}/?room=A-ABCDEFGH`);
  const foreign = new URL(`${cloudflare}/?room=A-ABCDEFGH&watch=1&token=private#private`);
  assert.throws(() => invitationRedirect(foreign, false, { ...config, backendId: 'cloudflare' }), /此邀请不属于当前站点/);
  assert.throws(() => invitationRedirect(foreign, true, { ...config, backendId: 'cloudflare' }), /此邀请不属于当前站点/);
  assert.equal(entryURL('https://evil.test', {}, config), null);
  await loadRuntimeConfig({ location, fetcher: async () => Response.json(runtime) });
  assert.equal(relayOrigin(legacy, location), domestic);
  assert.equal(relayURL('/api/presence', relayOrigin(legacy, location)), 'wss://wizard.magical-athlete-online.cn/api/presence');
  assert.equal(relayOrigin(domestic, new URL(legacy)), legacy, 'old browser keeps same-origin ws and its local credentials');
  assert.deepEqual(exactAllowedOrigins(`${legacy},${domestic}`), [legacy, domestic]);
  for (const value of ['*', 'https://*.example.com', 'https://example.com/', 'https://example.com/path', 'https://u:p@example.com']) assert.throws(() => exactAllowedOrigins(value));
});

function fetchFixture({ config = runtime, badAsset = false, externalAsset = false } = {}) {
  return async (url, options) => {
    assert.equal(options.redirect, 'error');
    if (url.pathname === '/api/health') return Response.json({ transport: 'node-websocket', version: 2, revision, siteEdition:'cn' });
    if (url.pathname === '/build-info.json') return Response.json({ revision, siteEdition:'cn' });
    if (url.pathname === '/runtime-config.json') return Response.json(config);
    if (url.pathname === '/') return new Response(`<script type="module" src="${externalAsset ? legacy : ''}/assets/game.js"></script><link rel="stylesheet" href="/assets/game.css">`);
    return new Response(badAsset ? '<html>fallback</html>' : '', { headers: { 'content-type': badAsset ? 'text/html' : url.pathname.endsWith('.js') ? 'application/javascript' : 'text/css' } });
  };
}
const socketFactory = url => {
  assert.equal(url.protocol, 'wss:'); assert.equal(url.origin, domestic.replace('https:', 'wss:'));
  const socket = { close() {} };
  queueMicrotask(() => socket.onmessage({ data: JSON.stringify({ type: 'probe', version: 2, revision }) }));
  return socket;
};
test('release probe checks HTTPS runtime persistence, same-origin assets and secure WebSocket', async () => {
  assert.deepEqual(await probe(domestic, revision, { fetcher: fetchFixture(), socketFactory }), { revision, origin: domestic, version: 2 });
  await assert.rejects(probe(domestic, revision, { fetcher: fetchFixture({ config: { ...runtime, backends: [{ ...runtime.backends[0], origin: legacy }] } }), socketFactory }), /overwritten/);
  await assert.rejects(probe(domestic, revision, { fetcher: fetchFixture({ badAsset: true }), socketFactory }), /content type/);
  await assert.rejects(probe(domestic, revision, { fetcher: fetchFixture({ externalAsset: true }), socketFactory }), /assets must be served/);
});

test('release transport diagnostics retain errno and stage without leaking signed URLs', async () => {
  const secret = 'https://storage.example/file?sig=private-secret';
  const failure = Error(`connect ${secret}`, { cause: new AggregateError([
    Object.assign(Error(secret), { code: 'ECONNREFUSED' }),
    Object.assign(Error(secret), { code: 'ETIMEDOUT' }),
  ]) });
  const safe = transportFailure('Checked artifact download failed', failure);
  assert.match(safe.message, /ECONNREFUSED/); assert.match(safe.message, /ETIMEDOUT/);
  assert.doesNotMatch(safe.message, /sig=|private-secret|storage\.example/);
  await assert.rejects(probe(domestic, revision, { fetcher: async () => { throw failure; }, socketFactory }), /Wizard HTTP probe \/api\/health failed \[ECONNREFUSED, ETIMEDOUT\]/);
});
