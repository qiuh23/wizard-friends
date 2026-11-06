import { readFileSync } from 'node:fs';
import { normalizeEdition } from '../src/site-policy.js';
const target = normalizeEdition(process.env.SITE_EDITION || 'global');
const info = JSON.parse(readFileSync('dist/build-info.json'));
const runtime = JSON.parse(readFileSync('dist/runtime-config.json'));
if (info.siteEdition !== target || runtime.siteEdition !== target || runtime.backends.length !== 1 || runtime.backendId !== (target === 'cn' ? 'aliyun' : 'cloudflare')) throw Error('Site artifact does not match deployment target.');
if (target === 'global') {
  const worker = JSON.parse(readFileSync('wrangler.jsonc'));
  if (worker.vars.SITE_EDITION !== target) throw Error('Worker policy does not match frontend.');
}
console.log(`Verified ${target} site artifact and target.`);
