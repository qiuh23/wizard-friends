import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from '@playwright/test';

// Run with local Vite (5182) and the existing Node API behind its /api proxy.
const base = process.env.GAME_URL || 'http://127.0.0.1:5182/';
const output = 'docs/qa/entry-design';
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'chrome', headless: true });
const errors = [], results = [];
const context = await browser.newContext();
const page = await context.newPage();
page.on('pageerror', error => errors.push(error.message));
const ratio = ({ ink, surface }) => {
  const rgb = value => value.match(/[\d.]+/g).slice(0, 3).map(Number).map(v => {
    const s = v / 255; return s <= .04045 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4;
  });
  const lum = value => { const c = rgb(value); return c[0] * .2126 + c[1] * .7152 + c[2] * .0722; };
  const a = lum(ink), b = lum(surface); return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
};
const colors = locator => locator.evaluate(el => {
  const style = getComputedStyle(el);
  return { ink: style.color, surface: style.backgroundColor, image: style.backgroundImage, opacity: style.opacity };
});
const load = async () => {
  await page.goto(base);
  await page.locator('#create').waitFor();
  await page.locator('.scene-host.ready canvas').waitFor();
  await page.waitForTimeout(750);
};
try {
  for (const [label, width, height] of [['desktop', 1440, 1000], ['portrait', 390, 844], ['landscape', 844, 390], ['narrow', 320, 568], ['tablet', 768, 1024]]) {
    await page.setViewportSize({ width, height });
    await load();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${label}: horizontal overflow`);
    const bounds = await page.locator('.home-title,#nickname,#create,#join-menu,#practice').evaluateAll(elements => elements.map(el => {
      const r = el.getBoundingClientRect(); return { name: el.id || el.className, x: r.x, y: r.y, w: r.width, h: r.height };
    }));
    for (let i = 0; i < bounds.length; i++) {
      const a = bounds[i];
      assert(a.x >= 0 && a.x + a.w <= width + 1, `${label}: ${a.name} clipped`);
      if (i > 0) assert(a.h >= 44, `${label}: ${a.name} touch size`);
      for (const b of bounds.slice(i + 1)) assert(!(a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y), `${label}: ${a.name}/${b.name} overlap`);
    }
    if (['desktop', 'portrait', 'landscape'].includes(label)) await page.screenshot({ path: `${output}/after-${label}.png`, fullPage: true });
    await page.locator('#join-menu').click();
    await page.locator('#room-input').fill('C-ABCD2345');
    await page.locator('#rules').click();
    await page.locator('#close-rules').click();
    assert.equal(await page.locator('#room-input').inputValue(), 'C-ABCD2345', `${label}: join draft lost`);
    await page.locator('#join-menu').click();
    results.push({ label, geometry: 'pass', joinDraftAndRules: 'pass' });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await load();
  await page.locator('#join-menu').click();
  const states = [];
  for (const selector of ['#create', '#join-menu', '#practice', '#nickname', '#room-input', '#join']) {
    const control = page.locator(selector);
    for (const state of ['default', 'hover', 'focus', 'disabled']) {
      await page.mouse.move(1400, 20);
      await control.blur();
      if (state === 'hover') await control.hover();
      if (state === 'focus') { await page.keyboard.press('Tab'); await control.focus(); }
      if (state === 'disabled') await control.evaluate(el => { el.disabled = true; });
      await page.waitForTimeout(200);
      const sample = await colors(control);
      const contrast = ratio(sample);
      assert(contrast >= 4.5, `${selector}/${state}: contrast ${contrast.toFixed(2)}`);
      assert.equal(sample.opacity, '1', `${selector}/${state}: opacity makes contrast ambiguous`);
      if (selector === '#create') assert.equal(sample.image, 'none', `${state}: primary color overridden by gradient`);
      if (state === 'focus') assert(await control.evaluate(el => el.matches(':focus-visible') && getComputedStyle(el).outlineStyle !== 'none'), `${selector}: missing keyboard focus`);
      states.push({ selector, state, contrast: Number(contrast.toFixed(2)), ...sample });
      if (state === 'disabled') await control.evaluate(el => { el.disabled = false; });
    }
  }
  await page.locator('#join-menu').click();
  await page.locator('#nickname').fill('入口验收');
  await page.locator('#quick-settings > summary').click();
  assert(await page.locator('[data-server-entry="cloudflare"]').isDisabled());
  const target = 'https://wizard.magical-athlete-online.cn/';
  await page.route(target, route => route.fulfill({ status: 200, contentType: 'text/html', body: '<title>Local navigation interception</title>' }));
  await page.locator('[data-server-entry="aliyun"]').click();
  await page.waitForURL(target);
  assert.equal(page.url(), target, 'server switch leaked query/identity');
  await load();
  const lobby = 'https://magical-athlete.qiuh23.workers.dev/lobby/';
  await page.route(lobby, route => route.fulfill({ status: 200, contentType: 'text/html', body: '<title>Local lobby interception</title>' }));
  await page.locator('.entry-context [data-lobby-navigation]').click();
  await page.waitForURL(lobby);
  assert.equal(page.url(), lobby, 'lobby navigation leaked query/identity');
  await load();
  await page.locator('#nickname').fill('入口验收');
  await page.locator('#create').click();
  await page.locator('.lobby-scene').waitFor();
  assert.equal(await page.locator('body').getAttribute('data-screen'), 'lobby');
  await page.screenshot({ path: `${output}/after-create-desktop.png`, fullPage: true });
  const roomCode = await page.locator('.room-code').textContent();
  const guestContext = await browser.newContext();
  const guest = await guestContext.newPage();
  guest.on('pageerror', error => errors.push(error.message));
  await guest.goto(`${base}?room=${encodeURIComponent(roomCode)}`);
  await guest.locator('#nickname').fill('邀请验收');
  assert.equal(await guest.locator('#room-input').inputValue(), roomCode, 'invite did not select room');
  await guest.locator('#join').click();
  await guest.locator('.lobby-scene').waitFor();
  assert.equal(await guest.locator('.room-code').textContent(), roomCode);
  const watcherContext = await browser.newContext();
  const watcher = await watcherContext.newPage();
  watcher.on('pageerror', error => errors.push(error.message));
  await watcher.goto(`${base}?room=${encodeURIComponent(roomCode)}&watch=1`);
  await watcher.locator('.spectator-banner').waitFor();
  assert.equal(await watcher.locator('body').getAttribute('data-spectator'), 'true');
  await watcherContext.close();
  await guestContext.close();
  const practiceContext = await browser.newContext();
  const practicePage = await practiceContext.newPage();
  practicePage.on('pageerror', error => errors.push(error.message));
  await practicePage.goto(base);
  await practicePage.locator('#nickname').fill('练习验收');
  await practicePage.locator('#practice').click();
  await practicePage.locator('.lobby-scene').waitFor();
  assert.equal(await practicePage.locator('input[name="short"][value="true"]').isChecked(), true, 'practice default changed');
  await practiceContext.close();
  assert.deepEqual(errors, []);
  const report = { results, states, navigation: 'server switch and lobby return intercepted locally; clean URLs', entry: 'real local Node create, invitation guest, invitation spectator and local practice pass', errors };
  await fs.writeFile(`${output}/results.json`, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); }
