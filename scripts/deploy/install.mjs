import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdtemp, readFile, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { probe } from './probe.mjs';

const repo = 'qiuh23/wizard-friends';
const base = '/opt/wizard-friends';
const library = '/usr/local/lib/wizard-friends-deploy';
const statePath = '/var/lib/wizard-friends-deploy-state/current.json';
export function validateRequest(encoded, user) {
  if (user !== 'wizard-deploy' || typeof encoded !== 'string' || encoded.length > 32000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw Error('Invalid Wizard deployment authorization.');
  const value = JSON.parse(Buffer.from(encoded, 'base64'));
  if (Object.keys(value).some(key => !['action', 'commit', 'runId', 'artifactId', 'artifactUrl', 'artifactSha256'].includes(key)) || !/^[a-f0-9]{40}$/.test(value.commit) || !Number.isSafeInteger(value.runId) || value.runId <= 0 || !['install', 'rollback'].includes(value.action)) throw Error('Invalid Wizard deployment request.');
  if (value.action === 'install') {
    if (!Number.isSafeInteger(value.artifactId) || value.artifactId <= 0 || !/^[a-f0-9]{64}$/.test(value.artifactSha256)) throw Error('Invalid checked artifact identity.');
    const url = new URL(value.artifactUrl);
    if (url.protocol !== 'https:' || url.port || url.username || url.password || url.hash || !/^productionresultssa[a-z0-9]*\.blob\.core\.windows\.net$/.test(url.hostname)) throw Error('Untrusted artifact delivery host.');
  } else if (value.artifactId !== undefined || value.artifactUrl !== undefined || value.artifactSha256 !== undefined) throw Error('Unexpected rollback artifact.');
  return value;
}
function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit', env: { PATH: '/opt/node/bin:/usr/sbin:/usr/bin:/sbin:/bin', LANG: 'C.UTF-8' }, timeout: 120000 });
  if (result.error || result.status !== 0) throw Error(`Fixed Wizard operation failed: ${command}`);
}
async function api(path) {
  const response = await fetch(`https://api.github.com/repos/${repo}/${path}`, { headers: { Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw Error(`Cannot verify current public GitHub release metadata: HTTP ${response.status}`);
  return response.json();
}
export async function validateCurrent(request, fetchApi = api) {
  const [branch, runInfo, artifact] = await Promise.all([fetchApi('branches/main'), fetchApi(`actions/runs/${request.runId}`), fetchApi(`actions/artifacts/${request.artifactId}`)]);
  if (branch.commit.sha !== request.commit || runInfo.head_sha !== request.commit || runInfo.head_branch !== 'main' || runInfo.repository?.full_name !== repo || runInfo.head_repository?.full_name !== repo || !['push', 'workflow_dispatch'].includes(runInfo.event) || runInfo.path !== '.github/workflows/verify.yml' || runInfo.conclusion !== 'success' || artifact.expired || artifact.name !== `aliyun-${request.commit}` || artifact.workflow_run?.id !== request.runId || artifact.digest !== `sha256:${request.artifactSha256}`) throw Error('Refusing stale, unsuccessful or mismatched main release.');
}
async function link(name, target) {
  const temporary = `${base}/${name}.next`;
  await rm(temporary, { force: true }); await symlink(target, temporary); await rename(temporary, `${base}/${name}`);
}
async function active() { try { return await realpath(`${base}/current`); } catch (e) { if (e.code !== 'ENOENT') throw e; return null; } }
function checkedRelease(path) { if (!new RegExp(`^${base}/releases/[a-f0-9]{40}-[1-9][0-9]*$`).test(path)) throw Error('Unexpected Wizard release path.'); return path; }
async function settings() {
  const env = await readFile('/etc/wizard-friends/server.env', 'utf8');
  const get = key => env.split('\n').find(line => line.startsWith(`${key}=`))?.slice(key.length + 1);
  const port = get('PORT'), origin = get('PUBLIC_ORIGIN');
  if (!/^\d+$/.test(port) || get('HOST') !== '127.0.0.1' || !origin) throw Error('Invalid root-managed Wizard environment.');
  return { port, origin };
}
async function waitProbe(origin, commit) {
  let last;
  for (let i = 0; i < 15; i++) { try { return await probe(origin, commit); } catch (e) { last = e; await new Promise(resolve => setTimeout(resolve, 1000)); } }
  throw last;
}
async function site(enabled) {
  const script = enabled ? 'ln -sfn /etc/nginx/sites-available/wizard-friends /etc/nginx/sites-enabled/wizard-friends; nginx -t; systemctl reload nginx' : 'rm -f /etc/nginx/sites-enabled/wizard-friends; nginx -t; systemctl reload nginx';
  run('/usr/bin/flock', ['--wait', '120', '/run/lock/game-sites.configure.lock', '/bin/bash', '-euc', script]);
}
async function restore(previous) {
  if (previous) { await link('current', checkedRelease(previous)); run('/usr/bin/systemctl', ['restart', 'wizard-friends']); }
  else { run('/usr/bin/systemctl', ['stop', 'wizard-friends']); await rm(`${base}/current`, { force: true }); await site(false); }
}
export async function install(encoded, user) {
  if (process.getuid?.() !== 0) throw Error('Root installer required.');
  const request = validateRequest(encoded, user);
  let state; try { state = JSON.parse(await readFile(statePath, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  const current = await active();
  const destination = `${base}/releases/${request.commit}-${request.runId}`;
  if (request.action === 'rollback') {
    if (current !== destination || state?.runId !== request.runId || state.commit !== request.commit) throw Error('Rollback requires this exact active attempt.');
    run('/bin/bash', [`${library}/backup.sh`]);
    await restore(state.previous);
    if (state.previous) { const config = await settings(); await waitProbe(`http://127.0.0.1:${config.port}`, state.previous.split('/').pop().split('-')[0]); }
    await writeFile(statePath, JSON.stringify({ ...state, rolledBack: true, active: state.previous }), { mode: 0o600 });
    return;
  }
  if (state && (state.runId > request.runId || (state.runId === request.runId && state.commit !== request.commit))) throw Error('A newer Wizard release already exists.');
  await validateCurrent(request);
  const work = await mkdtemp(join(tmpdir(), 'wizard-deploy-'));
  try {
    const response = await fetch(request.artifactUrl, { redirect: 'error', signal: AbortSignal.timeout(600000) });
    if (!response.ok || !response.body) throw Error('Artifact download failed.');
    let bytes = 0; const hash = createHash('sha256');
    const limit = new Transform({ transform(chunk, _, done) { bytes += chunk.length; if (bytes > 300 * 1024 * 1024) return done(Error('Artifact too large.')); hash.update(chunk); done(null, chunk); } });
    await pipeline(response.body, limit, createWriteStream(`${work}/artifact.zip`, { mode: 0o600 }));
    if (hash.digest('hex') !== request.artifactSha256) throw Error('Artifact ZIP digest mismatch.');
    run('/usr/bin/python3', [`${library}/unpack.py`, `${work}/artifact.zip`, work, encoded]);
    // Recheck after download and immediately before switching. Only fixed host
    // operations run as root; no package script or app code is executed as root.
    await validateCurrent(request);
    if (current === destination && !state?.rolledBack) { const c = await settings(); await waitProbe(`http://127.0.0.1:${c.port}`, request.commit); console.log('Exact release already active.'); return; }
    let reusable = false;
    try {
      if (await realpath(destination) !== destination || (await readFile(`${destination}/.artifact-sha256`, 'utf8')) !== request.artifactSha256) throw Error('Existing release differs from this checked artifact; inspect it before retrying.');
      reusable = true;
    } catch (e) { if (e.code !== 'ENOENT') throw e; }
    run('/bin/bash', [`${library}/backup.sh`]);
    if (!reusable) {
      await writeFile(`${work}/release/.artifact-sha256`, request.artifactSha256, { mode: 0o640 });
      await rename(`${work}/release`, destination);
      run('/bin/chown', ['-R', 'root:wizard', destination]); run('/bin/chmod', ['-R', 'u=rwX,g=rX,o=', destination]);
    }
    const config = await settings();
    try {
      await link('current', destination); run('/usr/bin/systemctl', ['restart', 'wizard-friends']);
      await waitProbe(`http://127.0.0.1:${config.port}`, request.commit);
      await site(true);
      await waitProbe(config.origin, request.commit);
      run('/usr/bin/systemctl', ['enable', 'wizard-friends']);
      if (current) await link('previous', checkedRelease(current));
      const next = `${statePath}.next`; await writeFile(next, JSON.stringify({ commit: request.commit, runId: request.runId, previous: current, active: destination, deployedAt: new Date().toISOString() }), { mode: 0o600 }); await rename(next, statePath);
      console.log(`Wizard release verified: ${request.commit}, run ${request.runId}, ${config.origin}`);
    } catch (e) { await restore(current); if (current) await waitProbe(`http://127.0.0.1:${config.port}`, current.split('/').pop().split('-')[0]); throw e; }
  } finally { await rm(work, { recursive: true, force: true }); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await install(process.argv[2], process.env.SUDO_USER); } catch (e) { console.error(e.message); process.exitCode = 1; }
}
