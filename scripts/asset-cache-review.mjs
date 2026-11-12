// Manual persistent-browser-cache regression. Use a built site; no production
// server, service worker, interception, forced cache mode or prefetch is needed.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { chromium } from '@playwright/test';
import { createServer } from '../server/index.js';

const root = await mkdtemp(join(tmpdir(), 'wizard-browser-cache-'));
let app, context;
try {
  const dist = join(root, 'dist'), profile = join(root, 'profile');
  const manifest = JSON.parse(await readFile('dist/asset-cache-manifest.json', 'utf8'));
  const paths = ['.glb', '.svg', '.js', '.css'].map(extension => manifest.immutable.find(path => path.endsWith(extension)));
  assert.ok(paths.every(Boolean));
  await mkdir(dist, { recursive: true });
  await writeFile(join(dist, 'index.html'), '<!doctype html><title>Browser cache check</title>');
  await writeFile(join(dist, 'asset-cache-manifest.json'), JSON.stringify(manifest));
  for (const path of paths) { await mkdir(dirname(join(dist, path)), { recursive: true }); await copyFile(`dist${path}`, join(dist, path)); }
  app = await createServer({ staticDir: dist, databasePath: ':memory:', port: 0, host: '127.0.0.1', publicOrigin: 'http://127.0.0.1', env: { SITE_EDITION: 'cn' } });
  const counts = new Map();
  app.server.on('request', request => { if (paths.includes(request.url)) counts.set(request.url, (counts.get(request.url) || 0) + 1); });
  const address = await app.listen(), origin = `http://127.0.0.1:${address.port}`;
  const launch = () => chromium.launchPersistentContext(profile, { headless: true,
    ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : { channel: process.env.BROWSER_CHANNEL || 'chrome' }) });
  const visit = async () => {
    const page = await context.newPage(); await page.goto(origin);
    const results = await page.evaluate(async paths => Promise.all(paths.map(async path => {
      const response = await fetch(path); return { path, ok: response.ok, bytes: (await response.arrayBuffer()).byteLength };
    })), paths);
    assert.ok(results.every(result => result.ok && result.bytes > 0)); await page.close();
  };
  context = await launch(); await visit(); assert.ok(paths.every(path => counts.get(path) === 1));
  await visit(); assert.ok(paths.every(path => counts.get(path) === 1), 'repeat visit must reuse assets without network requests');
  await context.close(); context = null;
  context = await launch(); await visit();
  assert.ok(paths.every(path => counts.get(path) === 1), 'same profile must reuse its disk cache after browser restart');
  console.log('Persistent browser-cache check passed: model, SVG, JS and CSS downloaded once across repeat visits and browser restart.');
} finally {
  await context?.close(); await app?.close(); await rm(root, { recursive: true, force: true });
}
