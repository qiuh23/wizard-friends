// Local/manual review only; intentionally not added to remote CI.
import { chromium, expect } from '@playwright/test';
import fs from 'node:fs';
import { createGame, addPlayer, act, viewFor } from '../src/game.js';
import { createRandomStream } from '../src/random.js';
import { DEFAULT_OPTIONS } from '../src/rules-options.js';

const base = process.env.GAME_URL || 'http://127.0.0.1:5173/';
const out = 'output/playwright';
fs.mkdirSync(out, { recursive: true });
const errors = [], checks = [];
function fixture(options, accept, count = 3) {
  const game = createGame();
  game.randomState = createRandomStream(Array(11).fill(4));
  for (let i = 0; i < count; i++) addPlayer(game, `p${i}`, ['青岚', '云舒', '风行', '清月', '星河', '林语'][i]);
  act(game, 'p0', { type: 'start', options: { ...DEFAULT_OPTIONS, ...options } });
  for (let step = 0; step < 10000; step++) {
    if (game.phase === 'play' && game.turn === 0 && accept(game)) {
      game.turnDeadline = Date.now() + 30000;
      return { version: 1, role: 'practice', room: '离线练习', me: 'p0', game, identities: {} };
    }
    if (game.phase === 'finished') break;
    if (['trickEnd', 'roundEnd'].includes(game.phase)) act(game, 'p0', { type: 'next' });
    else {
      const p = game.players.find(p => viewFor(game, p.id).canBid) ?? game.players[game.turn];
      const v = viewFor(game, p.id);
      act(game, p.id, game.phase === 'trump' ? { type: 'trump', suit: 'blue' } :
        game.phase === 'bid' ? { type: 'bid', value: v.bids[0] } : { type: 'play', card: v.legal[0] });
    }
  }
  throw Error(`No reachable fixture for ${JSON.stringify(options)}`);
}
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'chrome', headless: true, args: ['--disable-webgl'] });
async function open(saved, width, height) {
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: width < 851, isMobile: width < 600, reducedMotion: 'reduce' });
  await context.addInitScript(record => {
    sessionStorage.setItem('wizard-room-session', JSON.stringify(record));
  }, saved);
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base);
  await page.locator('.hand .card').first().waitFor();
  await expect(page.locator('#notice')).toBeEmpty({ timeout: 6000 });
  return { page, context };
}
function overlap(a, b) {
  return Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
    Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
}
async function checkChat(page, width, height) {
  await page.locator('#chat-toggle').click();
  await expect(page.locator('#room-chat')).toBeVisible();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const panel = await page.locator('#room-chat').boundingBox(), button = await page.locator('#chat-toggle').boundingBox();
  expect(button.y - panel.y - panel.height).toBeGreaterThanOrEqual(6);
  expect(button.y - panel.y - panel.height).toBeLessThanOrEqual(10);
  const aligned = Math.min(Math.abs(panel.x - button.x), Math.abs(panel.x + panel.width - button.x - button.width));
  expect(aligned).toBeLessThanOrEqual(1);
  expect(panel.x).toBeGreaterThanOrEqual(0);
  expect(panel.x + panel.width).toBeLessThanOrEqual(width + 1);
  expect(panel.y).toBeGreaterThanOrEqual(0);
  const confirm = await page.locator('#confirm-play').count() ? await page.locator('#confirm-play').boundingBox() : null;
  if (confirm) expect(overlap(panel, confirm)).toBe(0);
  const own = await page.locator('.own-status').count() ? await page.locator('.own-status').boundingBox() : null;
  if (own) expect(overlap(panel, own), JSON.stringify({ width, height, panel, own })).toBe(0);
  await page.locator('#chat-input').fill('保留正在输入的消息');
  await page.setViewportSize({ width: width - 1, height });
  await page.setViewportSize({ width, height });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expect(page.locator('#chat-input')).toHaveValue('保留正在输入的消息');
  const screen = await page.locator('body').getAttribute('data-screen');
  await page.screenshot({ path: `${out}/anchored-chat-${screen}-${width}.png` });
  await page.locator('#close-chat').click();
  await expect(page.locator('#chat-toggle')).toHaveAttribute('aria-expanded', 'false');
}
try {
  for (const predictionMode of ['public', 'hidden', 'secret']) for (const foresight of [false, true]) {
    const saved = fixture({ predictionMode, foresight, short: true, strict: predictionMode === 'public' }, g => {
      const hand = g.players[0].hand, v = viewFor(g, 'p0');
      return g.trick.some(p => p.card.kind === 'number') && hand.some(c => !v.legal.includes(c.id));
    });
    const expected = viewFor(saved.game, 'p0'), hand = saved.game.players[0].hand;
    const illegal = hand.find(c => !expected.legal.includes(c.id));
    const legal = hand.find(c => c.kind === 'number' && expected.legal.includes(c.id));
    const { page, context } = await open(saved, 390, 844);
    await page.locator('#table-menu').click();
    await page.locator('#hand-expand').click();
    await page.locator('#table-menu').click();
    await expect(page.locator(`.hand [data-card="${illegal.id}"]`)).not.toHaveClass(/playable/);
    await page.locator(`.hand [data-card="${illegal.id}"]`).click();
    await expect(page.locator('#confirm-play')).toBeDisabled();
    await expect(page.locator('.selected-preview')).toContainText('必须跟色');
    expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('wizard-room-session')).game.players[0].hand.length)).toBe(hand.length);
    await page.locator(`.hand [data-card="${legal.id}"]`).click();
    await expect(page.locator('#confirm-play')).toBeEnabled();
    await page.locator('#confirm-play').click();
    await expect(page.locator('.hand .card')).toHaveCount(hand.length - 1);
    checks.push({ predictionMode, foresight, illegalPreviewCannotSubmit: true, followsSuit: true });
    await context.close();
  }
  const widths = new Map();
  for (const [width, height] of [[1440, 900], [390, 844], [844, 390]]) for (const count of [1, 5, 15, 20]) {
    const saved = fixture({}, g => g.round === count);
    const { page, context } = await open(saved, width, height);
    const section = await page.locator('.hand-section').boundingBox();
    const style = await page.locator('.hand-section').evaluate(node => ({ border: getComputedStyle(node).borderTopWidth, background: getComputedStyle(node).backgroundImage }));
    expect(style).toEqual({ border: '0px', background: 'none' });
    const previous = widths.get(width) ?? 0;
    expect(section.width).toBeGreaterThanOrEqual(previous);
    if (count === 5) expect(section.width).toBeGreaterThan(previous + 50);
    widths.set(width, section.width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (height < 541) expect((await page.locator('.own-status').boundingBox()).width).toBeLessThanOrEqual(210);
    await page.screenshot({ path: `${out}/unframed-hand-${width}-${count}.png` });
    if (count === 5) await checkChat(page, width, height);
    checks.push({ width, height, count, handWidth: section.width, unframed: true });
    await context.close();
  }
  for (const [width, height] of [[1440, 900], [390, 844], [844, 390]]) {
    const context = await browser.newContext({ viewport: { width, height } });
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    await page.goto(base); await page.locator('#practice').click();
    await checkChat(page, width, height);
    checks.push({ width, height, lobbyChat: true });
    await context.close();
  }
  expect(errors).toEqual([]);
  fs.writeFileSync(`${out}/rules-ui-results.json`, JSON.stringify({ checks, errors }, null, 2));
  console.log(JSON.stringify({ cases: checks.length, errors }));
} finally { await browser.close(); }
