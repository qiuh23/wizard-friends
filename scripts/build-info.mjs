import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { normalizeEdition } from '../src/site-policy.js';
const siteEdition = normalizeEdition(process.env.SITE_EDITION);
const backendId = siteEdition === 'cn' ? 'aliyun' : 'cloudflare';
writeFileSync('dist/build-info.json', JSON.stringify({
  revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  relay: '', siteEdition,
}, null, 2));
writeFileSync('dist/runtime-config.json', JSON.stringify({ siteEdition, backendId, relayOrigin: '',
  backends: [{ id: backendId, origin: '', enabled: true }],
}, null, 2));
