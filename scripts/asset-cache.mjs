import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { immutableAssetSet } from '../server/static-cache.js';

export const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable';
export const ASSET_PREFIX = 'assets/immutable/';

// Hash bytes, not release IDs: an unrelated code release must reuse the same
// model URL. Never grant immutable caching to the old, fixed public URLs.
export function fingerprintModels(directory) {
  return readdirSync(directory).filter(name => name.endsWith('.glb')).sort().map(name => {
    const source = readFileSync(resolve(directory, name));
    const hash = createHash('sha256').update(source).digest('hex');
    return { name: name.slice(0, -4), fileName: `${ASSET_PREFIX}${name.slice(0, -4)}-${hash}.glb`, source };
  });
}

export function cacheArtifacts(fileNames) {
  const immutable = [...new Set(fileNames.filter(name => name.startsWith(ASSET_PREFIX)))].sort().map(name => `/${name}`);
  if (immutableAssetSet({ version: 1, immutable }).size !== immutable.length) throw Error('Only fingerprinted static files belong in immutable asset output.');
  const fixed = [['/', 'no-cache'], ['/index.html', 'no-cache'], ['/runtime-config.json', 'no-store'], ['/build-info.json', 'no-store'], ['/asset-cache-manifest.json', 'no-store']];
  // Cloudflare permits 100 static rules. Exact entries, rather than a blanket
  // /assets/* rule, keep missing/old asset URLs and SPA fallbacks out of the
  // immutable cache. Fail closed if the future asset set outgrows this limit.
  if (immutable.length + fixed.length > 100) throw Error('Asset cache headers exceed Cloudflare\'s 100 static-rule limit.');
  const headers = [...fixed, ...immutable.map(path => [path, IMMUTABLE_CACHE])]
    .map(([path, policy]) => `${path}\n  Cache-Control: ${policy}`).join('\n\n') + '\n';
  return { headers, manifest: JSON.stringify({ version: 1, immutable }, null, 2) + '\n' };
}

export function assetCachePlugin() {
  let models;
  return {
    name: 'wizard-content-addressed-assets', apply: 'build',
    config(config) {
      models = fingerprintModels(resolve(config.root || process.cwd(), 'public/assets/wizard-v4'));
      // All emitted JS lives beside these files. Relative URLs resolved from
      // import.meta.url work on a subpath as well as the two production roots.
      const paths = Object.fromEntries(models.map(model => [model.name, `./${model.fileName.slice(ASSET_PREFIX.length)}`]));
      return { define: { __WIZARD_ASSET_PATHS__: JSON.stringify(paths) }, build: { rollupOptions: { output: {
        entryFileNames: `${ASSET_PREFIX}[name]-[hash].js`, chunkFileNames: `${ASSET_PREFIX}[name]-[hash].js`, assetFileNames: `${ASSET_PREFIX}[name]-[hash][extname]`,
      } } } };
    },
    buildStart() {
      for (const model of models) this.emitFile({ type: 'asset', fileName: model.fileName, source: model.source });
    },
    generateBundle(_options, bundle) {
      const { headers, manifest } = cacheArtifacts(Object.keys(bundle));
      this.emitFile({ type: 'asset', fileName: '_headers', source: headers });
      this.emitFile({ type: 'asset', fileName: 'asset-cache-manifest.json', source: manifest });
    },
  };
}
