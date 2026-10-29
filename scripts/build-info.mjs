import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

// Public build configuration travels with the single verified artifact, so a
// later Cloudflare or manual Pages deploy can identify the verified revision.
writeFileSync('dist/build-info.json', JSON.stringify({
  revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  relay: process.env.VITE_RELAY_URL || '',
}, null, 2));
