// Preserve the release/manual entry and its historical aliases. The React UI
// follows the current automatic trick/round flow; one regression owns it.
process.env.GAME_URL ||= 'http://127.0.0.1:8787/';
process.env.MIGRATION_CASE = 'network';
await import('./react-migration-review.mjs');
