import { createHash } from 'node:crypto';

export function immutableAssetSet(manifest) {
  if (manifest?.version !== 1 || !Array.isArray(manifest.immutable)) return new Set();
  // Only the generated, fingerprinted output namespace is eligible. Never
  // trust a manifest entry that would cache HTML or runtime configuration.
  return new Set(manifest.immutable.filter(path => typeof path === 'string' && /^\/assets\/immutable\/[\w.-]+-[\w-]{8,}\.(?:js|css|svg|png|jpe?g|webp|avif|gif|ico|woff2?|ttf|otf|mp3|ogg|wav|glb)$/.test(path)));
}

export function staticCacheHeaders(path, data, immutable) {
  const cache = path.endsWith('.json') ? 'no-store' : immutable.has(path) ? 'public, max-age=31536000, immutable' : 'no-cache';
  return { 'Cache-Control': cache, ETag: `"${createHash('sha256').update(data).digest('hex')}"` };
}

export function matchesETag(header, etag) {
  // GET/HEAD use weak comparison. If-None-Match may contain multiple values.
  return typeof header === 'string' && header.split(',').some(value => value.trim() === '*' || value.trim().replace(/^W\//, '') === etag);
}
