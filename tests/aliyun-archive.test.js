import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('Aliyun archive extraction rejects traversal, links, foreign members and mismatched frontend SHA', () => {
  const result = spawnSync(process.platform === 'win32' ? 'python' : 'python3', ['scripts/deploy/test_archive.py'], { encoding: 'utf8', timeout: 15000 });
  assert.equal(result.status, 0, result.error?.message || result.stdout + result.stderr);
});
