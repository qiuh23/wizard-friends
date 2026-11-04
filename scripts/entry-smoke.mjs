import { chromium, expect } from '@playwright/test';
import { createServer as createPortServer } from 'node:net';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from '../server/index.js';

// Local-only entry regression. Both origins run the real Node/SQLite authority;
// the Cloudflare runtime response is a fixture, not a public Worker acceptance.
const directory = await mkdtemp(join(tmpdir(), 'wizard-entry-'));
const apps = [], errors = [], requests = [], sockets = [], navigationReferrers = [];
let browser;
async function freePort() {
  const server = createPortServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
try {
  const cloudflarePort = await freePort(), aliyunPort = await freePort();
  const origins = { cloudflare: `http://127.0.0.1:${cloudflarePort}`, aliyun: `http://127.0.0.1:${aliyunPort}` };
  const backends = Object.entries(origins).map(([id, origin]) => ({ id, origin, enabled: true }));
  for (const [id, origin] of Object.entries(origins)) {
    const app = await createServer({ host: '127.0.0.1', port: Number(new URL(origin).port), publicOrigin: origin,
      staticDir: resolve('dist'), databasePath: join(directory, `${id}.sqlite`),
      env: { BACKENDS_CONFIG_JSON: JSON.stringify(backends.map(entry => entry.id === 'aliyun' ? { ...entry, origin } : entry)) }, onError(error) { errors.push(error.message); } });
    await app.listen(); apps.push(app);
  }
  browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true, args: ['--disable-webgl'] });
  async function context() {
    const result = await browser.newContext();
    await result.route(`${origins.cloudflare}/runtime-config.json`, route => route.fulfill({ json: { backendId: 'cloudflare', relayOrigin: '', backends } }));
    result.on('request', request => {
      requests.push(request.url());
      if (request.isNavigationRequest() && request.headers().referer) navigationReferrers.push(request.headers().referer);
    });
    result.on('page', page => {
      page.on('pageerror', error => errors.push(error.message));
      page.on('websocket', socket => sockets.push(socket.url()));
    });
    return result;
  }
  const navigationContext = await context(), navigation = await navigationContext.newPage();
  await navigation.goto(`${origins.cloudflare}/?token=private&next=https://evil.test#private`);
  await navigation.locator('[data-entry="aliyun"]').click();
  await expect(navigation).toHaveURL(`${origins.aliyun}/`);
  await navigation.locator('[data-entry="cloudflare"]').click();
  await expect(navigation).toHaveURL(`${origins.cloudflare}/`);
  await mkdir('.local/wizard-entry', { recursive: true });
  for (const viewport of [{ width: 320, height: 780 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
    await navigation.setViewportSize(viewport);
    expect(await navigation.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await navigation.screenshot({ path: `.local/wizard-entry/home-${viewport.width}.png`, fullPage: true });
  }

  const hostContext = await context(), host = await hostContext.newPage();
  await host.goto(origins.aliyun);
  await host.locator('#nickname').fill('入口验收房主');
  await host.locator('#create').click();
  await host.locator('body[data-connection="connected"]').waitFor();
  const session = page => page.evaluate(() => JSON.parse(sessionStorage.getItem('wizard-room-session:aliyun') || 'null'));
  const original = await session(host);
  expect(original.role).toBe('host');
  await host.reload();
  await host.locator('body[data-connection="connected"]').waitFor();
  expect((await session(host)).me).toBe(original.me);

  const watcherContext = await context(), watcher = await watcherContext.newPage();
  await watcher.goto(`${origins.cloudflare}/?room=${original.room}&server=aliyun&game=wizard&watch=1&token=private&next=https://evil.test#private`);
  await expect(watcher).toHaveURL(`${origins.aliyun}/?room=A-${original.room}&watch=1`);
  await watcher.locator('body[data-connection="connected"]').waitFor();
  expect((await session(watcher)).role).toBe('spectator');
  await watcher.reload();
  await watcher.locator('body[data-connection="connected"]').waitFor();
  expect((await session(watcher)).role).toBe('spectator');

  // Current-room recovery keeps its original authority and credentials under
  // the established transition policy, even when another pool is invited.
  await host.goto(`${origins.aliyun}/?room=C-ABCDEFGH&watch=1`);
  await host.locator('body[data-connection="connected"]').waitFor();
  expect(new URL(host.url()).origin).toBe(origins.aliyun);
  expect((await session(host)).room).toBe(original.room);
  expect((await session(host)).me).toBe(original.me);

  for (const search of ['?room=A-ABCDEFGH&server=cloudflare', '?room=ABCDEFGH&room=HGFEDCBA', '?room=ABCDEFGH&watch=1&watch=0', '?room=ABCDEFGH&game=athlete']) {
    await navigation.goto(origins.cloudflare + '/' + search);
    await expect(navigation.locator('#app')).toContainText('邀请');
    await expect(navigation.getByRole('button', { name: '返回当前服务器' })).toBeVisible();
    await expect(navigation.locator('#create')).toHaveCount(0);
  }
  await navigationContext.route(`${origins.cloudflare}/runtime-config.json`, route => route.fulfill({ json: {
    backendId: 'cloudflare', relayOrigin: '', backends: backends.map(entry => ({ ...entry, enabled: entry.id === 'cloudflare' })),
  } }));
  await navigation.goto(`${origins.cloudflare}/?room=A-ABCDEFGH&watch=1`);
  await expect(navigation.locator('#app')).toContainText('暂未开放');
  await navigation.getByRole('button', { name: '返回当前服务器' }).click();
  await expect(navigation).toHaveURL(`${origins.cloudflare}/`);
  await expect(navigation.locator('[data-entry="aliyun"]')).toBeDisabled();
  expect(errors).toEqual([]);
  expect(navigationReferrers).toEqual([]);
  expect(requests.every(url => Object.values(origins).includes(new URL(url).origin))).toBe(true);
  expect(sockets.length).toBeGreaterThan(0);
  expect(sockets.every(url => Object.values(origins).includes(new URL(url.replace(/^ws/, 'http')).origin))).toBe(true);
  console.log(JSON.stringify({ result: 'passed', origins: Object.keys(origins), widths: [320, 390, 844], requests: requests.length, webSockets: sockets.length, errors }));
} finally {
  await browser?.close();
  await Promise.all(apps.map(app => app.close()));
  await rm(directory, { recursive: true, force: true });
}
