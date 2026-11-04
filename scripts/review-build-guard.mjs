// Review-only branches must never upload a Cloudflare version or shared preview.
// GitHub Actions separately uses [skip ci] on this PR's HEAD commit.
// This opt-in branch prefix does not change main or ordinary preview behavior.
export function assertBuildAllowed(env = process.env) {
  if (env.WORKERS_CI === '1' && String(env.WORKERS_CI_BRANCH || '').startsWith('codex/review-only/')) {
    throw Error('Review-only branch: Cloudflare build/deployment is intentionally blocked. Merge the reviewed change to main to use the existing release workflow.');
  }
}
assertBuildAllowed();
