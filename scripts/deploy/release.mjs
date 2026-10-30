import { execFileSync } from 'node:child_process';
import { appendFile, readFile } from 'node:fs/promises';
import { probe } from './probe.mjs';

const release = JSON.parse(await readFile(process.env.RELEASE_RECORD, 'utf8'));
const origin = process.env.ALIYUN_PUBLIC_ORIGIN;
if (!origin || new URL(origin).origin !== origin || !['http:', 'https:'].includes(new URL(origin).protocol)) throw Error('Configure an exact public Aliyun origin including its nonstandard port.');
function aliyun(command, args) {
  try { return JSON.parse(execFileSync('aliyun', ['ecs', command, '--region', process.env.ALIYUN_REGION_ID, '--RegionId', process.env.ALIYUN_REGION_ID, ...args], { encoding: 'utf8', timeout: 45000, maxBuffer: 2 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] })); }
  catch { throw Error(`Aliyun ${command} failed; command contents and credentials are withheld.`); }
}
function mask(value) { console.log(`::add-mask::${value}`); }
async function invoke(action) {
  if (!/^cn-[a-z0-9-]+$/.test(process.env.ALIYUN_REGION_ID || '') || !/^i-[a-z0-9]+$/.test(process.env.ALIYUN_INSTANCE_ID || '')) throw Error('Missing fixed ECS region/instance.');
  const payload = { action, commit: release.commit, runId: release.runId };
  if (action === 'install') {
    const response = await fetch(`https://api.github.com/repos/qiuh23/wizard-friends/actions/artifacts/${release.artifactId}/zip`, { redirect: 'manual', headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(20000) });
    if (response.status !== 302) throw Error('Cannot obtain the short-lived checked artifact URL.');
    const url = new URL(response.headers.get('location'));
    if (url.protocol !== 'https:' || url.port || url.username || url.password || url.hash || !/^productionresultssa[a-z0-9]*\.blob\.core\.windows\.net$/.test(url.hostname)) throw Error('Untrusted artifact URL.');
    Object.assign(payload, { artifactId: release.artifactId, artifactSha256: release.artifactSha256, artifactUrl: url.href }); mask(url.href);
  }
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64'); mask(encoded);
  const command = Buffer.from(`#!/usr/bin/env bash\nset -euo pipefail\nexec sudo -- /usr/local/sbin/wizard-friends-ci-install '${encoded}'\n`).toString('base64'); mask(command);
  const result = aliyun('RunCommand', ['--InstanceId.1', process.env.ALIYUN_INSTANCE_ID, '--Name', `wizard-${action}-${release.runId}`, '--Type', 'RunShellScript', '--Username', 'wizard-deploy', '--WorkingDir', '/tmp', '--Timeout', '900', '--KeepCommand', 'false', '--RepeatMode', 'Once', '--ContentEncoding', 'Base64', '--CommandContent', command]);
  if (typeof result.InvokeId !== 'string') throw Error('Cloud Assistant did not return an invocation ID.');
  console.log(`Wizard ${action} invocation: ${result.InvokeId}`);
  const deadline = Date.now() + 920000;
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 5000));
    const response = aliyun('DescribeInvocationResults', ['--InvokeId', result.InvokeId, '--InstanceId', process.env.ALIYUN_INSTANCE_ID]);
    const row = response.Invocation?.InvocationResults?.InvocationResult?.[0] || response.InvocationResults?.InvocationResult?.[0];
    if (row?.InvocationStatus === 'Success' && row.ExitCode === 0) return;
    if (['Failed', 'Timeout', 'Cancelled', 'Stopped', 'Terminated', 'Invalid'].includes(row?.InvocationStatus)) throw Error(`Wizard ${action} failed: ${row.InvocationStatus}, exit ${row.ExitCode}. Inspect ${result.InvokeId}.`);
  }
  throw Error(`Invocation ${result.InvokeId} timed out; inspect live state before retrying.`);
}
if (process.argv[2] === 'install' || process.argv[2] === 'rollback') await invoke(process.argv[2]);
else if (process.argv[2] === 'verify') {
  await probe(origin, release.commit);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `Wizard Aliyun release verified: [${origin}](${origin})\n\nFull SHA: \`${release.commit}\` · Verify run: ${release.runId}\n\nFrontend/backend SHA, version 2 and WebSocket upgrade/protocol marker passed. Athlete services were not released by this workflow.\n`);
} else throw Error('Unknown release operation.');
