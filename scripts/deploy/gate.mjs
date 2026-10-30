import { appendFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export function selectRelease(run, branch, artifacts, repository = 'qiuh23/wizard-friends') {
  if (repository !== 'qiuh23/wizard-friends' || run.repository?.full_name !== repository || run.head_repository?.full_name !== repository || run.head_branch !== 'main' || !['push', 'workflow_dispatch'].includes(run.event) || run.path !== '.github/workflows/verify.yml' || run.conclusion !== 'success' || run.head_sha !== branch.commit?.sha || !/^[a-f0-9]{40}$/.test(run.head_sha)) return null;
  const matches = artifacts.filter(a => a.name === `aliyun-${run.head_sha}` && !a.expired);
  if (matches.length !== 1 || !/^sha256:[a-f0-9]{64}$/.test(matches[0].digest || '')) throw Error('One unexpired verified Linux artifact with GitHub SHA256 is required.');
  return { commit: run.head_sha, runId: run.id, artifactId: matches[0].id, artifactSha256: matches[0].digest.slice(7) };
}
async function api(path) {
  const response = await fetch(`https://api.github.com/repos/qiuh23/wizard-friends/${path}`, { headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw Error(`GitHub release check failed: HTTP ${response.status}`);
  return response.json();
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const event = JSON.parse(await (await import('node:fs/promises')).readFile(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const id = process.env.CHECKS_RUN_ID || event.inputs?.verification_run || event.workflow_run?.id;
  if (!/^[1-9][0-9]*$/.test(String(id))) throw Error('A verification run ID is required.');
  const [run, branch, artifacts] = await Promise.all([api(`actions/runs/${id}`), api('branches/main'), api(`actions/runs/${id}/artifacts?per_page=100`)]);
  const selected = selectRelease(run, branch, artifacts.artifacts);
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `deploy=${Boolean(selected)}\n`);
  if (selected) await writeFile(process.env.RELEASE_RECORD, JSON.stringify(selected));
  else console.log('No release: this is not the successful verification of the current main commit. The current live game is retained.');
}
