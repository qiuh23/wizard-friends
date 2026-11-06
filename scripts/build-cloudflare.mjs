import { spawnSync } from 'node:child_process';
// This entry point is a trusted, fixed global target for the existing Workers Builds integration.
for (const script of ['check','test:release','build','worker:check']) {
  const result = spawnSync(process.execPath, [process.env.npm_execpath, 'run', script], {stdio:'inherit',env:{...process.env,SITE_EDITION:'global'}});
  if (result.status !== 0) process.exit(result.status || 1);
}
