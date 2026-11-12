import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fingerprintModels, cacheArtifacts } from './asset-cache.mjs';
import { immutableAssetSet } from '../server/static-cache.js';

export function checkAssetCache(dist = 'dist', models = 'public/assets/wizard-v4') {
  const manifest = JSON.parse(readFileSync(resolve(dist, 'asset-cache-manifest.json')));
  const emitted = readdirSync(resolve(dist, 'assets/immutable')).map(name => `assets/immutable/${name}`);
  const expected = cacheArtifacts(emitted);
  if (JSON.stringify(manifest) !== JSON.stringify(JSON.parse(expected.manifest))) throw Error('Asset cache manifest does not match emitted files.');
  if (readFileSync(resolve(dist, '_headers'), 'utf8') !== expected.headers) throw Error('Cloudflare cache headers do not match the asset manifest.');
  if (immutableAssetSet(manifest).size !== emitted.length) throw Error('Unversioned or unsupported file in immutable asset output.');
  const scripts = emitted.filter(path => path.endsWith('.js')).map(path => readFileSync(resolve(dist, path), 'utf8')).join('\n');
  const fingerprints = fingerprintModels(resolve(models));
  for (const model of fingerprints) {
    if (!manifest.immutable.includes(`/${model.fileName}`) || !readFileSync(resolve(dist, model.fileName)).equals(model.source)) throw Error(`Model bytes or cache identity mismatch: ${model.name}`);
    if (!scripts.includes(model.fileName.split('/').at(-1))) throw Error(`Built loader does not reference the versioned model: ${model.name}`);
  }
  return { immutable: emitted.length, models: fingerprints.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  console.log('Verified content-addressed model URLs, static cache manifest and Cloudflare headers:', checkAssetCache());
}
