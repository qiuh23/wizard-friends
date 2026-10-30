import test from 'node:test';
import assert from 'node:assert/strict';
import { selectRelease } from '../scripts/deploy/gate.mjs';
import { validateCurrent, validateRequest } from '../scripts/deploy/install.mjs';

const commit = 'a'.repeat(40);
const hash = 'b'.repeat(64);
const run = { id: 10, head_sha: commit, head_branch: 'main', path: '.github/workflows/verify.yml', event: 'push', conclusion: 'success', repository: { full_name: 'qiuh23/wizard-friends' }, head_repository: { full_name: 'qiuh23/wizard-friends' } };
const artifact = { id: 20, name: `aliyun-${commit}`, digest: `sha256:${hash}`, expired: false, workflow_run: { id: 10 } };
const branch = { commit: { sha: commit } };
const request = { action: 'install', commit, runId: 10, artifactId: 20, artifactSha256: hash, artifactUrl: 'https://productionresultssa0.blob.core.windows.net/actions/artifact?sig=temporary' };
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64');

test('Aliyun gate selects only the successful exact current main artifact', () => {
  assert.deepEqual(selectRelease(run, branch, [artifact]), { commit, runId: 10, artifactId: 20, artifactSha256: hash });
  for (const change of [{ conclusion: 'failure' }, { head_sha: 'c'.repeat(40) }, { head_branch: 'feature' }, { event: 'pull_request' }, { path: '.github/workflows/other.yml' }, { head_repository: { full_name: 'fork/wizard-friends' } }]) {
    assert.equal(selectRelease({ ...run, ...change }, branch, [artifact]), null);
  }
  assert.throws(() => selectRelease(run, branch, [{ ...artifact, expired: true }]), /unexpired/);
  assert.throws(() => selectRelease(run, branch, [artifact, artifact]), /One unexpired/);
  assert.throws(() => selectRelease(run, branch, [{ ...artifact, digest: null }]), /SHA256/);
});

test('fixed Wizard installer cannot select athlete targets, users, arbitrary URLs or shell commands', () => {
  assert.deepEqual(validateRequest(encode(request), 'wizard-deploy'), request);
  for (const user of ['athlete-deploy', 'athlete-preview-deploy', 'root']) assert.throws(() => validateRequest(encode(request), user), /authorization/);
  for (const change of [{ target: 'production' }, { commit: 'main' }, { runId: -1 }, { artifactUrl: 'http://productionresultssa0.blob.core.windows.net/file' }, { artifactUrl: 'https://evil.example/file' }, { artifactUrl: 'https://productionresultssa0.blob.core.windows.net:8443/file' }, { artifactUrl: 'https://user@productionresultssa0.blob.core.windows.net/file' }, { artifactSha256: 'bad' }]) assert.throws(() => validateRequest(encode({ ...request, ...change }), 'wizard-deploy'));
  const rollback = { action: 'rollback', commit, runId: 10 };
  assert.deepEqual(validateRequest(encode(rollback), 'wizard-deploy'), rollback);
  assert.throws(() => validateRequest(encode({ ...rollback, artifactUrl: request.artifactUrl }), 'wizard-deploy'), /Unexpected rollback/);
});

test('host rechecks current main, completed verification and artifact identity before switching', async () => {
  const metadata = { 'branches/main': branch, 'actions/runs/10': run, 'actions/artifacts/20': artifact };
  await validateCurrent(request, async path => metadata[path]);
  for (const [path, replacement] of [
    ['branches/main', { commit: { sha: 'c'.repeat(40) } }],
    ['actions/runs/10', { ...run, conclusion: 'failure' }],
    ['actions/artifacts/20', { ...artifact, digest: `sha256:${'c'.repeat(64)}` }],
    ['actions/artifacts/20', { ...artifact, workflow_run: { id: 9 } }],
  ]) await assert.rejects(validateCurrent(request, async key => key === path ? replacement : metadata[key]), /stale|mismatched/);
});
