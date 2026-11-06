import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyDeployment } from '../scripts/verify-deployment.mjs';

const revision = 'a'.repeat(40);
const health = { transport: 'cloudflare-websocket', version: 2, siteEdition:'global' };
const response = data => new Response(JSON.stringify(data));
const options = { revision, attempts: 1, retryDelay: 0 };

test('deployment verification requires both the expected frontend revision and Worker protocol', async () => {
  const result = await verifyDeployment({ ...options, fetcher: async url => {
    assert.equal(url.searchParams.get('revision'), revision);
    return response(url.pathname === '/api/health' ? health : { revision, siteEdition:'global' });
  } });
  assert.deepEqual(result, { revision, transport:health.transport,version:health.version });
});

test('deployment verification rejects an old frontend even when the Worker is healthy', async () => {
  await assert.rejects(verifyDeployment({ ...options, fetcher: async url =>
    response(url.pathname === '/api/health' ? health : { revision: 'b'.repeat(40), siteEdition:'global' }),
  }), /different revision/);
});

test('deployment verification rejects the previous Worker protocol and unsuccessful health responses', async () => {
  for (const unhealthy of [response({ ...health, version: 1 }), new Response('Unavailable', { status: 503 })]) {
    await assert.rejects(verifyDeployment({ ...options, fetcher: async url =>
      url.pathname === '/api/health' ? unhealthy : response({ revision, siteEdition:'global' }),
    }), /expected version 2|HTTP 503/);
  }
});

test('deployment verification retries while a published frontend propagates', async () => {
  let reads = 0;
  const result = await verifyDeployment({ ...options, attempts: 2, fetcher: async url => {
    if (url.pathname === '/api/health') return response(health);
    reads += 1;
    return response({ revision: reads === 1 ? 'b'.repeat(40) : revision, siteEdition:'global' });
  } });
  assert.equal(reads, 2);
  assert.equal(result.revision, revision);
});

test('deployment verification fails before making requests if the expected revision is missing', async () => {
  await assert.rejects(verifyDeployment({ fetcher: () => assert.fail('Unexpected request') }), /full Git commit SHA/);
});

test('Cloudflare publication compares the deployed entry configuration with the checked frontend', async () => {
  const runtime = { siteEdition:'global', backendId: 'cloudflare', relayOrigin: '', backends: [{ id: 'cloudflare', origin: '', enabled: true }] };
  for (const changed of [false, true]) {
    const call = verifyDeployment({ ...options, expectedRuntime: runtime, fetcher: async url => {
      if (url.pathname === '/api/health') return response(health);
      if (url.pathname === '/runtime-config.json') return response(changed ? { ...runtime, backends: [{...runtime.backends[0],origin:'http://115.29.188.62:8081'}] } : runtime);
      return response({ revision, siteEdition:'global' });
    } });
    if (changed) await assert.rejects(call, /runtime configuration differs/);
    else assert.equal((await call).revision, revision);
  }
});
