import { pathToFileURL } from 'node:url';
import { setTimeout } from 'node:timers/promises';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { normalizeRuntimeConfig } from '../src/backend-entry.js';

const productionUrl = 'https://wizard-friends.qiuh23.workers.dev/';

export async function verifyDeployment({
  revision,
  url = productionUrl,
  attempts = 12,
  retryDelay = 5000,
  fetcher = fetch,
  expectedRuntime,
} = {}) {
  if (!/^[a-f0-9]{40}$/.test(revision || '')) {
    throw new Error('EXPECTED_REVISION must be the full Git commit SHA.');
  }

  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const [info, health] = await Promise.all(['build-info.json', 'api/health'].map(async path => {
        const endpoint = new URL(path, url);
        endpoint.searchParams.set('revision', revision);
        const response = await fetcher(endpoint, {
          cache: 'no-store',
          signal: AbortSignal.timeout(10000),
        });
        if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}.`);
        return response.json();
      }));
      if (info.revision !== revision) throw new Error('The live frontend is still on a different revision.');
      if (health.transport !== 'cloudflare-websocket' || health.version !== 2) {
        throw new Error('The live Worker does not expose the expected version 2 protocol.');
      }
      if (expectedRuntime) {
        const endpoint = new URL('runtime-config.json', url);
        endpoint.searchParams.set('revision', revision);
        const response = await fetcher(endpoint, { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(10000) });
        if (!response.ok) throw new Error(`runtime-config.json returned HTTP ${response.status}.`);
        const normalize = value => {
          const config = normalizeRuntimeConfig(value, new URL(url).origin);
          return JSON.stringify({ ...config, backends: config.backends.sort((a, b) => a.id.localeCompare(b.id)) });
        };
        if (normalize(await response.json()) !== normalize(expectedRuntime)) throw new Error('The live runtime configuration differs from the checked frontend; a server entry may have been overwritten.');
      }
      return { revision: info.revision, transport: health.transport, version: health.version };
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await setTimeout(retryDelay);
    }
  }
  throw new Error(`Deployment verification failed after ${attempts} attempts: ${lastError.message}`, { cause: lastError });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const revision = process.env.EXPECTED_REVISION || execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const expectedRuntime = JSON.parse(await readFile('dist/runtime-config.json', 'utf8'));
    const result = await verifyDeployment({ revision, expectedRuntime });
    console.log(`Verified Cloudflare deployment: ${JSON.stringify(result)}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
