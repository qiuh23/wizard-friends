import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'vite';
import { fingerprintModels, cacheArtifacts, assetCachePlugin, IMMUTABLE_CACHE } from '../scripts/asset-cache.mjs';
import { checkAssetCache } from '../scripts/check-asset-cache.mjs';
import { wizardAssetURL } from '../src/rendering/wizard-asset-url.mjs';
import { immutableAssetSet, staticCacheHeaders, matchesETag } from '../server/static-cache.js';
import { createServer } from '../server/index.js';
import worker from '../worker/index.js';

async function directory(t) {
  const dir = await mkdtemp(join(tmpdir(), 'wizard-cache-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test('each model URL follows its own bytes, not timestamps, builds or other models', async t => {
  const dir = await directory(t);
  await writeFile(join(dir, 'a.glb'), 'first model'); await writeFile(join(dir, 'b.glb'), 'second model');
  const before = fingerprintModels(dir);
  await writeFile(join(dir, 'a.glb'), 'first model');
  assert.deepEqual(fingerprintModels(dir), before);
  await writeFile(join(dir, 'a.glb'), 'updated first model');
  const after = fingerprintModels(dir);
  assert.notEqual(after[0].fileName, before[0].fileName);
  assert.equal(after[1].fileName, before[1].fileName);
  assert.match(after[0].fileName, /a-[a-f0-9]{64}\.glb$/);
});

test('model loader uses versioned module-relative URLs, retaining explicit custom and dev paths', () => {
  const paths = { candle: './candle-abcdef12.glb' };
  for (const base of ['https://example.test/', 'https://example.test/game/']) {
    assert.equal(wizardAssetURL('candle', undefined, paths, `${base}assets/immutable/table-01234567.js`), `${base}assets/immutable/candle-abcdef12.glb`);
  }
  assert.equal(wizardAssetURL('candle', '/custom/', paths), '/custom/candle.glb');
  assert.equal(wizardAssetURL('candle'), '/assets/wizard-v4/candle.glb');
});

test('generated Cloudflare headers match only current fingerprinted files, never whole asset folders', () => {
  const path = 'assets/immutable/candle-abcdef12.glb';
  const { headers, manifest } = cacheArtifacts([path, path, 'index.html', 'assets/wizard-v4/candle.glb']);
  assert.deepEqual(JSON.parse(manifest).immutable, [`/${path}`]);
  assert.ok(headers.includes(`/${path}\n  Cache-Control: ${IMMUTABLE_CACHE}`));
  assert.ok(headers.includes('/index.html\n  Cache-Control: no-cache'));
  for (const name of ['runtime-config', 'build-info', 'asset-cache-manifest']) assert.ok(headers.includes(`/${name}.json\n  Cache-Control: no-store`));
  assert.doesNotMatch(headers, /\*|wizard-v4|api\//);
  for (const file of ['index-abcdef12.html', 'runtime-abcdef12.json', 'fixed.glb']) assert.throws(() => cacheArtifacts([`assets/immutable/${file}`]), /Only fingerprinted/);
  assert.throws(() => cacheArtifacts(Array.from({ length: 96 }, (_, i) => `assets/immutable/${i}-abcdef12.js`)), /100/);
});

test('manifest cannot turn HTML, dynamic configuration or unversioned files into immutable assets', () => {
  const good = '/assets/immutable/candle-abcdef12.glb';
  const paths = [good, '/index.html', '/runtime-config.json', '/assets/wizard-v4/candle.glb', '/assets/immutable/index-abcdef12.html', '/assets/immutable/runtime-abcdef12.json', '/assets/immutable/../index-abcdef12.js'];
  assert.deepEqual([...immutableAssetSet({ version: 1, immutable: paths })], [good]);
  assert.equal(immutableAssetSet({ version: 2, immutable: [good] }).size, 0);
  assert.equal(staticCacheHeaders('/index.html', 'page', new Set()).ETag, staticCacheHeaders('/index.html', 'page', new Set()).ETag);
  assert.notEqual(staticCacheHeaders('/index.html', 'page', new Set()).ETag, staticCacheHeaders('/index.html', 'new page', new Set()).ETag);
});

test('conditional cache comparison handles weak validators, lists and wildcard', () => {
  for (const input of ['"abc"', 'W/"abc"', '"old", W/"abc"', '*']) assert.equal(matchesETag(input, '"abc"'), true);
  for (const input of [undefined, 'abc', '"old"', 'w/"abc"']) assert.equal(matchesETag(input, '"abc"'), false);
});

test('production Vite builds preserve unchanged URLs and change only edited asset URLs', async t => {
  const dir = await directory(t);
  const models = join(dir, 'public/assets/wizard-v4'); await mkdir(models, { recursive: true });
  await writeFile(join(models, 'candle.glb'), 'model a'); await writeFile(join(models, 'table.glb'), 'model b');
  await writeFile(join(dir, 'index.html'), '<script type="module" src="/main.js"></script>');
  await writeFile(join(dir, 'main.js'), 'window.assetPaths = __WIZARD_ASSET_PATHS__;');
  const compile = async () => {
    const result = await build({ root: dir, configFile: false, logLevel: 'silent', base: './', plugins: [assetCachePlugin()], build: { write: false } });
    return new Map(result.output.map(output => [output.fileName, output.type === 'asset' ? output.source : output.code]));
  };
  const first = await compile(), second = await compile();
  assert.deepEqual([...first.keys()], [...second.keys()]);
  const modelPaths = [...first.keys()].filter(path => path.endsWith('.glb'));
  assert.equal(modelPaths.length, 2);
  const js = [...first].find(([path]) => path.endsWith('.js'))[1];
  for (const path of modelPaths) assert.ok(js.includes(path.split('/').at(-1)));
  await writeFile(join(models, 'candle.glb'), 'changed model a');
  const third = await compile();
  const oldCandle = modelPaths.find(path => path.includes('/candle-')), table = modelPaths.find(path => path.includes('/table-'));
  assert.equal(third.has(oldCandle), false); assert.equal(third.has(table), true);
  assert.ok([...third.keys()].some(path => path.includes('/candle-') && path !== oldCandle));
  const manifest = JSON.parse(third.get('asset-cache-manifest.json'));
  assert.ok(manifest.immutable.every(path => third.has(path.slice(1))));
  assert.ok(!third.get('_headers').includes(oldCandle));
  const dist = join(dir, 'checked-output');
  for (const [path, content] of third) {
    await mkdir(join(dist, path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''), { recursive: true });
    await writeFile(join(dist, path), content);
  }
  assert.deepEqual(checkAssetCache(dist, models), { immutable: 3, models: 2 });
  await writeFile(join(dist, table), 'corrupted model');
  assert.throws(() => checkAssetCache(dist, models), /bytes or cache identity/);
  await writeFile(join(dist, table), third.get(table));
  await writeFile(join(dist, '_headers'), '/*\n  Cache-Control: public, max-age=31536000, immutable\n');
  assert.throws(() => checkAssetCache(dist, models), /headers do not match/);
});

test('Node serves immutable assets and real 304s while HTML, legacy files and runtime remain fresh', async t => {
  const dir = await directory(t), model = '/assets/immutable/candle-abcdef12.glb';
  await mkdir(join(dir, 'assets/immutable'), { recursive: true });
  await writeFile(join(dir, model), 'cached model');
  await writeFile(join(dir, 'index.html'), '<p>first</p>');
  await writeFile(join(dir, 'legacy.js'), 'first code');
  await writeFile(join(dir, 'build-info.json'), '{}');
  await writeFile(join(dir, 'asset-cache-manifest.json'), JSON.stringify({ version: 1, immutable: [model] }));
  const app = await createServer({ staticDir: dir, databasePath: ':memory:', host: '127.0.0.1', port: 0, publicOrigin: 'https://wizard.test', env: { SITE_EDITION: 'cn' } });
  const address = await app.listen(); t.after(() => app.close());
  const get = (path, options) => fetch(`http://127.0.0.1:${address.port}${path}`, options);
  const first = await get(model); assert.equal(first.status, 200);
  assert.equal(first.headers.get('cache-control'), IMMUTABLE_CACHE); assert.equal(first.headers.get('content-type'), 'model/gltf-binary');
  assert.equal(await first.text(), 'cached model');
  const second = await get(model, { headers: { 'If-None-Match': first.headers.get('etag') } });
  assert.equal(second.status, 304); assert.equal(await second.text(), ''); assert.equal(second.headers.get('cache-control'), IMMUTABLE_CACHE);
  const head = await get(model, { method: 'HEAD' }); assert.equal(await head.text(), ''); assert.equal(head.headers.get('etag'), first.headers.get('etag')); assert.equal(head.headers.get('content-length'), '12');
  for (const path of ['/', '/a/spa/path', '/legacy.js']) {
    const old = await get(path); assert.equal(old.headers.get('cache-control'), 'no-cache');
    assert.equal((await get(path, { headers: { 'If-None-Match': old.headers.get('etag') } })).status, 304);
    await writeFile(join(dir, path.endsWith('.js') ? 'legacy.js' : 'index.html'), `changed ${path}`);
    const fresh = await get(path, { headers: { 'If-None-Match': old.headers.get('etag') } });
    assert.equal(fresh.status, 200); assert.notEqual(fresh.headers.get('etag'), old.headers.get('etag'));
  }
  for (const path of ['/runtime-config.json', '/api/health', '/api/no-such-endpoint', '/build-info.json', '/asset-cache-manifest.json', '/assets/immutable/missing-abcdef12.glb']) {
    const result = await get(path); assert.equal(result.headers.get('cache-control'), 'no-store', path);
    assert.notEqual(result.status, 304);
  }
  const post = await get(model, { method: 'POST' }); assert.equal(post.status, 405); assert.equal(post.headers.get('cache-control'), 'no-store');
});

test('Cloudflare runtime config, health and API failures explicitly forbid browser caching', async () => {
  for (const edition of ['global', 'cn']) {
    const env = { SITE_EDITION: edition, ASSETS: { fetch: () => Response.json({ siteEdition: edition }) } };
    for (const path of ['/runtime-config.json', '/api/health', '/api/unknown']) {
      const response = await worker.fetch(new Request(`https://wizard.test${path}`), env);
      assert.equal(response.headers.get('cache-control'), 'no-store');
    }
  }
  assert.equal((await worker.fetch(new Request('https://wizard.test/api/health'), {})).headers.get('cache-control'), 'no-store');
});
