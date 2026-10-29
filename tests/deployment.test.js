import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyDeployment } from '../scripts/verify-deployment.mjs';

const revision = 'a'.repeat(40);
const health = { transport: 'cloudflare-websocket', version: 2 };
const response = data => new Response(JSON.stringify(data));
const options = { revision, attempts: 1, retryDelay: 0 };

test('deployment verification requires both the expected frontend revision and Worker protocol', async () => {
  const result = await verifyDeployment({ ...options, fetcher: async url => {
    assert.equal(url.searchParams.get('revision'), revision);
    return response(url.pathname === '/api/health' ? health : { revision });
  } });
  assert.deepEqual(result, { revision, ...health });
});

test('deployment verification rejects an old frontend even when the Worker is healthy', async () => {
  await assert.rejects(verifyDeployment({ ...options, fetcher: async url =>
    response(url.pathname === '/api/health' ? health : { revision: 'b'.repeat(40) }),
  }), /different revision/);
});

test('deployment verification rejects the previous Worker protocol and unsuccessful health responses', async () => {
  for (const unhealthy of [response({ ...health, version: 1 }), new Response('Unavailable', { status: 503 })]) {
    await assert.rejects(verifyDeployment({ ...options, fetcher: async url =>
      url.pathname === '/api/health' ? unhealthy : response({ revision }),
    }), /expected version 2|HTTP 503/);
  }
});

test('deployment verification retries while a published frontend propagates', async () => {
  let reads = 0;
  const result = await verifyDeployment({ ...options, attempts: 2, fetcher: async url => {
    if (url.pathname === '/api/health') return response(health);
    reads += 1;
    return response({ revision: reads === 1 ? 'b'.repeat(40) : revision });
  } });
  assert.equal(reads, 2);
  assert.equal(result.revision, revision);
});

test('deployment verification fails before making requests if the expected revision is missing', async () => {
  await assert.rejects(verifyDeployment({ fetcher: () => assert.fail('Unexpected request') }), /full Git commit SHA/);
});
