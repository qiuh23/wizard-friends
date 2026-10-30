import { chromium, expect } from '@playwright/test';
import fs from 'node:fs';
import { winnerReason } from '../src/table-summary.js';

// Deliberately small: one real three-client round, recovery and room controls.
// Longer layout/variant matrices remain local/manual.
// This is a networking/authority check. Software WebGL on GPU-less CI runners
// can starve input handling across the clients; graphics have their own checks.
const base = process.env.GAME_URL || 'http://127.0.0.1:8787/';
const backend = process.env.GAME_BACKEND || 'cloudflare';
const sessionKey = backend === 'aliyun' ? 'wizard-room-session:aliyun' : 'wizard-room-session';
const evidence = 'output/playwright';
fs.mkdirSync(evidence, { recursive: true });
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'chrome', headless: true,
  args: ['--disable-webgl'] });
const pages = [], errors = [];
let watcher;
const session = page => page.evaluate(key => JSON.parse(sessionStorage.getItem(key) || 'null'), sessionKey);
const state = async page => { const saved = await session(page); return saved?.state || saved?.game; };
async function connected(page) {
  await page.locator('body[data-connection="connected"]').waitFor({ timeout: 30000 });
}
async function position(page) {
  const saved = await session(page), view = saved?.state || saved?.game;
  return view && { phase: view.phase, round: view.round, turn: view.turn,
    trick: view.trick, options: view.options, history: view.history,
    players: view.players.map(p => ({ id: p.id, bid: p.bid, won: p.won, score: p.score, hand: p.hand })) };
}
async function chooseRules(page) {
  await page.locator('#rules-form').waitFor();
  for (const [key, value] of Object.entries({ short: true, predictionMode: 'secret', foresight: false })) {
    await page.locator(`input[name="${key}"][value="${value}"]`).check();
  }
}
async function closeScores(page) {
  const close = page.locator('.close-scores');
  if (await close.isVisible()) await close.click();
}
async function chatControlsInViewport(page) {
  // Check before clicking: Playwright scrolling cannot repair a panel whose
  // parent trigger moved to the header while its popup still opens upwards.
  const layout = await page.locator('#room-chat').evaluate(panel => {
    const rect = node => { const r=node.getBoundingClientRect(); return {left:r.left,right:r.right,top:r.top,bottom:r.bottom}; };
    return { panel:rect(panel), width:innerWidth, height:innerHeight, scrollY,
      controls:['#close-chat','#chat-input','#chat-form button'].map(selector=>{
        const node=panel.querySelector(selector), r=node.getBoundingClientRect();
        return {...rect(node),hit:node.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2))};
      }) };
  });
  expect(layout.scrollY).toBe(0);
  for(const r of [layout.panel,...layout.controls]) {
    expect(r.left).toBeGreaterThanOrEqual(0);expect(r.right).toBeLessThanOrEqual(layout.width);
    expect(r.top).toBeGreaterThanOrEqual(0);expect(r.bottom).toBeLessThanOrEqual(layout.height);
  }
  expect(layout.controls.every(control=>control.hit)).toBe(true);
}
async function actOnce(page) {
  if (await page.locator('[data-trump]').count()) {
    await page.locator('[data-trump]').first().click();
    await expect.poll(async () => (await state(page)).phase).not.toBe('trump');
    return true;
  }
  if (await page.locator('[data-bid]').count()) {
    const { me } = await session(page);
    await page.locator('[data-bid]').first().click();
    await expect.poll(async () => (await state(page)).players.find(p => p.id === me)?.bidSubmitted).toBe(true);
    return true;
  }
  const view = await state(page), saved = await session(page);
  if (view?.phase === 'play' && view.players[view.turn]?.id === saved.me && view.legal?.length) {
    await page.locator(`.hand [data-card="${view.legal[0]}"]`).click();
    await page.locator('#confirm-play').click();
    await expect.poll(async () => (await state(page)).eventSeq).toBeGreaterThan(view.eventSeq);
    return true;
  }
  return false;
}
try {
  for (let i = 0; i < 3; i++) {
    const context = await browser.newContext(i === 0
      ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' }
      : { viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', dialog => dialog.accept());
    pages.push(page); await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.locator('#nickname').fill(['房主', '蓝巫师', '绿巫师'][i]);
  }
  let [host, guest, other] = pages;
  await host.locator('#create').click(); await connected(host);
  const room = await host.locator('.room-code').innerText();
  for (const page of [guest, other]) {
    await page.locator('#join-menu').click(); await page.locator('#room-input').fill(room);
    await page.locator('#join').click(); await connected(page);
  }
  for (const page of pages) await expect.poll(async () => (await state(page))?.players.length).toBe(3);
  await chooseRules(host);
  for (const page of [guest, other]) await expect(page.locator('#rules-form input').first()).toBeDisabled();
  await host.locator('#start').click();
  for (const page of pages) await page.locator('.table').waitFor();
  await expect(host.locator('.lead-callout')).toBeVisible();
  await expect(host.locator('.lead-callout')).toContainText('首墩先手');
  // Authority secrets must never enter even the host browser cache.
  for (const page of pages) {
    const saved = await session(page), view = saved.state;
    expect(saved.game).toBeUndefined();
    expect(view.randomState).toBeUndefined(); expect(view.identities).toBeUndefined();
    expect(view.players.filter(p => Array.isArray(p.hand))).toHaveLength(1);
  }
  for (let i = 0; i < 6 && (await state(host)).phase !== 'play'; i++) {
    for (const page of pages) await actOnce(page);
    await host.waitForTimeout(80);
  }
  await expect.poll(async () => (await state(host)).phase).toBe('play');
  for (const page of pages) {
    const saved = await session(page);
    expect(saved.state.players.filter(p => p.id !== saved.me).every(p => p.bid == null)).toBe(true);
  }
  const watcherContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  watcher = await watcherContext.newPage(); watcher.on('dialog', dialog => dialog.accept());
  watcher.on('pageerror', error => errors.push(error.message));
  await watcher.goto(`${base}?room=${room}&watch=1`); await connected(watcher);
  await expect.poll(async () => (await state(watcher))?.spectator).toBe(true);
  const publicState = await state(watcher);
  expect(publicState.players.every(p => p.hand === undefined && p.bid == null)).toBe(true);
  expect(publicState.randomState).toBeUndefined();
  await expect(watcher.locator('.hand [data-card], [data-bid]')).toHaveCount(0);
  await host.waitForTimeout(1200);
  const beforePause = await Promise.all(pages.map(position));
  await host.locator('#room-pause').click();
  await expect.poll(async () => (await state(guest))?.lifecycle?.paused).toBe(true);
  const paused = await state(guest);
  await host.waitForTimeout(1100);
  expect(await Promise.all(pages.map(position))).toEqual(beforePause);
  await guest.locator('#chat-toggle').click();
  await chatControlsInViewport(guest);
  await guest.locator('#chat-input').fill('暂停期间仍可聊天');
  await guest.locator('#chat-form button').click();
  await expect(host.locator('#chat-messages span').last()).toHaveText('暂停期间仍可聊天');
  await expect(host.locator('.chat-notice')).toContainText('暂停期间仍可聊天');
  await host.locator('.chat-notice').click();
  await expect(host.locator('#room-chat')).toBeVisible();
  await chatControlsInViewport(host);
  await expect(host.locator('.chat-notice')).toHaveCount(0);
  await host.locator('#close-chat').click();
  await guest.locator('#close-chat').click();
  // Really close the host tab. A fresh tab explicitly claims the same browser's
  // room-scoped return handle; merely toggling network emulation can leave WS alive.
  const hostContext = host.context(); await host.close();
  await expect.poll(async () => (await state(guest))?.lifecycle?.hostOffline).toBe(true);
  await connected(guest); expect((await state(guest)).lifecycle.paused).toBe(true);
  host = await hostContext.newPage(); pages[0] = host; host.setDefaultTimeout(15000);
  host.on('pageerror', error => errors.push(error.message));
  host.on('dialog', dialog => dialog.accept());
  await host.goto(base); await host.locator('#resume-room').click(); await connected(host);
  await expect.poll(async () => (await state(guest))?.lifecycle?.hostOffline).toBe(false);
  await expect.poll(async () => (await state(host))?.lifecycle?.paused).toBe(true);
  await host.locator('#room-pause').click();
  await expect.poll(async () => (await state(guest))?.lifecycle?.paused).toBe(false);
  const remaining = (await state(guest)).turnDeadline - Date.now();
  expect(remaining).toBeLessThanOrEqual(paused.lifecycle.remainingMs + 500);
  expect(remaining).toBeGreaterThan(paused.lifecycle.remainingMs - 1500);
  // An actual refresh must recover the same round, cards and score.
  const beforeReload = await position(host); await host.reload(); await connected(host);
  await expect.poll(() => position(host)).toEqual(beforeReload);
  for (let step = 0; step < 25 && (await state(host)).phase !== 'roundEnd'; step++) {
    for (const page of pages) await actOnce(page);
    await host.waitForTimeout(100);
  }
  await expect.poll(async () => (await state(host)).phase).toBe('roundEnd');
  const results = (await state(host)).history;
  for (const page of pages) {
    await expect.poll(async () => (await state(page)).history).toEqual(results);
    await page.locator('.personal-result').waitFor();
    await closeScores(page);
  }
  await host.locator('#table-scores').click();
  await expect(host.locator('.score-ledger tbody tr')).toHaveCount(1);
  await expect(host.locator('.score-ledger')).toContainText('预测');
  await closeScores(host);
  await host.screenshot({ path: `${evidence}/smoke-mobile-result.png` });
  await guest.screenshot({ path: `${evidence}/smoke-desktop-result.png` });
  const options = (await state(host)).options;
  await host.locator('#next').click();
  await expect.poll(async () => (await state(host)).round).toBe(2);
  expect((await state(host)).options).toEqual(options);
  await expect(host.locator('#rules-form')).toHaveCount(0);
  for (let step = 0; step < 25 && (await state(host)).phase !== 'trickEnd'; step++) {
    for (const page of pages) await actOnce(page);
    await host.waitForTimeout(80);
  }
  await expect.poll(async () => (await state(host)).phase).toBe('trickEnd');
  const review = await state(host), winnerName = review.players[review.lastWinner].name;
  await expect(host.locator('.settlement-summary h3')).toHaveText(`${winnerName} 赢得本墩`);
  await expect(host.locator('.settlement-summary .action-title small')).toHaveText(`下一墩 ${winnerName} 首攻`);
  const details = host.locator('.settlement-details');
  expect(await details.getAttribute('open')).toBeNull();
  await details.locator('summary').click();
  const reason = details.locator('.settlement-details-body > p').first();
  await expect(reason).toBeVisible();
  await expect(reason).toHaveText(winnerReason(review.trick,review.trump,review.options.deckMode));
  await details.locator('summary').click();
  await expect(host.locator('#trick-review-timer')).toBeVisible();
  await host.waitForTimeout(2000);
  expect((await state(host)).phase).toBe('trickEnd');
  await expect.poll(async () => (await state(host)).phase, {timeout:7000}).toBe('play');
  expect((await state(host)).turn).toBe(review.lastWinner);
  await host.locator('#table-menu').click();
  await host.locator('#room-dissolve').click();
  for (const page of pages) await page.locator('#create').waitFor();
  await watcher.locator('#create').waitFor();
  // Closed rooms remain tombstoned and cannot be revived with their old link.
  if (!await guest.locator('#room-input').isVisible()) await guest.locator('#join-menu').click();
  await guest.locator('#room-input').fill(room);
  await guest.locator('#join').click();
  await expect(guest.locator('#notice')).toContainText(/关闭|解散/);
  expect(errors).toEqual([]);
  console.log(JSON.stringify({ clients: 3, graphics: '2D', transport: backend === 'aliyun' ? 'Node + SQLite + WebSockets' : 'local Durable Objects + WebSockets',
    verified: ['secret-bid privacy', 'host cache privacy', 'read-only spectator privacy', 'pause freezes gameplay', 'chat while paused',
      'host tab close and explicit new-tab return', 'resume remaining deadline', 'host refresh', 'round scores synchronized', 'host-only whole-game rules', 'live chat bubble and click-to-open', 'five-second trick review and next leader', 'dissolve tombstone'], errors }));
} catch (error) {
  for (const [i, page] of pages.entries()) await page.screenshot({ path: `${evidence}/failure-${i}.png` }).catch(() => {});
  console.error(JSON.stringify({ errors, pages: await Promise.all(pages.map(async page => ({
    body: await page.locator('body').innerText().catch(() => ''),
    position: await position(page).catch(() => null) }))) }));
  throw error;
} finally { await browser.close(); }
