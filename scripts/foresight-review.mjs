// Local/manual review only. No workflow, browser matrix or CI job is added.
import { chromium, expect } from '@playwright/test';
import fs from 'node:fs';
import { createGame, addPlayer, act, viewFor } from '../src/game.js';
import { createRandomStream } from '../src/random.js';
import { DEFAULT_OPTIONS } from '../src/rules-options.js';
import { sortCards } from '../src/hand-model.js';

const base = process.env.GAME_URL || 'http://127.0.0.1:5196/';
const out = 'output/playwright/foresight';
fs.mkdirSync(out, { recursive: true });
const checks = [], errors = [], failures = [];
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'chrome', headless: true });
const overlaps = (a, b) => a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1;
const fixtures = new Map();
function fixture(count, cards, deckMode = 'standard', predictionMode = 'hidden', phase = 'bid', seed = 8) {
  const key = [count, cards, deckMode, predictionMode, phase, seed].join('-');
  if (fixtures.has(key)) return structuredClone(fixtures.get(key));
  const game = createGame(); game.randomState = createRandomStream(Array(11).fill(seed));
  for (let i = 0; i < count; i++) addPlayer(game, `p${i}`, ['远帆', '青山学徒的长昵称', '林间守望者', '清月', '星河', '林语'][i]);
  act(game, 'p0', { type: 'start', options: { ...DEFAULT_OPTIONS, deckMode, predictionMode, foresight: true } });
  for (let step = 0; step < 16000; step++) {
    if ((cards === null || game.cardsPerRound === cards) && game.phase === phase && (phase !== 'bid' || viewFor(game, 'p0').canBid)) {
      const saved = { version: 1, role: 'practice', room: '离线练习', me: 'p0', game, identities: {} };
      fixtures.set(key, structuredClone(saved)); return saved;
    }
    const id = game.players[game.turn].id, view = viewFor(game, id);
    if (game.phase === 'trump') act(game, id, { type: 'trump', suit: 'yellow' });
    else if (game.phase === 'bid') {
      const bidder = game.players.find(player => viewFor(game, player.id).canBid);
      act(game, bidder.id, { type: 'bid', value: viewFor(game, bidder.id).bids[0] });
    } else if (game.phase === 'play') act(game, id, { type: 'play', card: view.legal[0] });
    else if (['trickEnd', 'roundEnd'].includes(game.phase)) act(game, 'p0', { type: 'next' });
    else break;
  }
  if (phase === 'trump' && cards === null && seed < 30) return fixture(count, cards, deckMode, predictionMode, phase, seed + 1);
  throw Error(`Unreachable legal fixture ${key}`);
}
async function settle(page) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.waitForTimeout(80);
}
async function open(saved, width, height, { graphics = false, handSort = 'suit' } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: width < 1000, reducedMotion: 'reduce' });
  if (!graphics) await context.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (name, ...args) { return /webgl/.test(name) ? null : original.call(this, name, ...args); };
  });
  await context.addInitScript(({ saved, handSort }) => {
    if (!sessionStorage.getItem('foresight-review-seeded')) {
      sessionStorage.setItem('wizard-room-session', JSON.stringify(saved));
      sessionStorage.setItem('wizard-hand-sort', handSort);
      sessionStorage.setItem('foresight-review-seeded', 'true');
    }
    localStorage.setItem('wizard-trump-motion', 'false'); localStorage.setItem('wizard-turn-sound', 'false');
  }, { saved, handSort });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.route(/\/src\/main\.js(?:\?|$)/, async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + `
      window.__foresightReview={get state(){return state;},get game(){return game;},get me(){return me;},
        clear(){clearTimeout(turnTimer);clearTimeout(botTimer);notify('');},
        async submitOther(){const {act}=await import('/src/game.js');const p=game.players.find(p=>p.id!==me&&viewFor(game,p.id).canBid);
          if(!p)return false;act(game,p.id,{type:'bid',value:viewFor(game,p.id).bids[0]});broadcast();this.clear();return true;},
        async finishBids(){const {act}=await import('/src/game.js');
          while(game.phase==='bid'){const p=game.players.find(p=>viewFor(game,p.id).canBid);act(game,p.id,{type:'bid',value:viewFor(game,p.id).bids[0]});}
          broadcast();this.clear();},
        async apply(next){game=next;state=viewFor(game,me);updateEventEffects(true);render();this.clear();}};` });
  });
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.__foresightReview, null, { timeout: 10000 }).catch(async error => { console.error(await page.locator('body').innerText()); throw error; });
  await page.locator('.table').waitFor();
  await page.evaluate(() => window.__foresightReview.clear());
  await settle(page);
  return { context, page };
}
async function geometry(page) {
  return page.evaluate(() => {
    const rect = node => { const r = node.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; };
    const visible = node => node.offsetWidth && node.offsetHeight && getComputedStyle(node).visibility !== 'hidden';
    const panel = document.querySelector('.foresight-hands');
    return { width: innerWidth, height: innerHeight, panel: rect(panel), panelClient: panel.clientHeight,
      overflow: panel.scrollWidth > panel.clientWidth + 1, pageOverflow: document.documentElement.scrollWidth > innerWidth,
      surface: { background: getComputedStyle(panel).backgroundColor, border: getComputedStyle(panel).borderTopWidth },
      obstacles: [...document.querySelectorAll('.opponents .player,.own-status,.action-panel,.concealed-hand,.trump-display')].filter(visible).map(rect),
      hint: (() => { const node = document.querySelector('.concealed-hand'), range = document.createRange(); range.selectNodeContents(node); return { ...rect(node), text: rect(range), scrollWidth: node.scrollWidth, clientWidth: node.clientWidth }; })(),
      groups: [...panel.querySelectorAll('.foresight-player')].map(node => ({ box: rect(node), heading: rect(node.querySelector('h3')), cards: [...node.querySelectorAll('.card')].map(rect) })) };
  });
}
async function verifyLayout(page, label, { scroll = true } = {}) {
  await settle(page);
  const g = await geometry(page), panel = page.locator('.foresight-hands');
  expect(g.pageOverflow, label).toBe(false); expect(g.overflow, label).toBe(false);
  expect(g.surface, `${label} keeps the felt visible without a large framed panel`).toEqual({ background: 'rgba(0, 0, 0, 0)', border: '0px' });
  expect(g.panel.width, label).toBeGreaterThan(140);
  expect(g.panelClient, `${label} must fit a full readable card`).toBeGreaterThanOrEqual(g.groups[0].cards[0].height);
  expect(g.panel.left, label).toBeGreaterThanOrEqual(0);
  expect(g.panel.right, label).toBeLessThanOrEqual(g.width);
  expect(g.panel.top, label).toBeGreaterThanOrEqual(0);
  expect(g.panel.bottom, label).toBeLessThanOrEqual(g.height);
  for (const obstacle of g.obstacles) expect(overlaps(g.panel, obstacle), `${label} panel vs ${JSON.stringify(obstacle)}`).toBe(false);
  expect(g.hint.scrollWidth, label).toBeLessThanOrEqual(g.hint.clientWidth);
  expect(g.hint.text.height, label).toBeLessThanOrEqual(24);
  expect(g.hint.text.left, label).toBeGreaterThanOrEqual(g.hint.left);
  expect(g.hint.text.right, label).toBeLessThanOrEqual(g.hint.right);
  for (let i = 0; i < g.groups.length; i++) {
    const group = g.groups[i];
    if (i) expect(group.box.top, label).toBeGreaterThanOrEqual(g.groups[i - 1].box.bottom - 1);
    expect(group.cards[0].top, label).toBeGreaterThanOrEqual(group.heading.bottom);
    for (const card of group.cards) {
      expect(card.width, label).toBeGreaterThanOrEqual(g.width > 850 && g.height > 540 ? 64 : 52);
      expect(card.left, label).toBeGreaterThanOrEqual(g.panel.left);
      expect(card.right, label).toBeLessThanOrEqual(g.panel.right);
    }
  }
  await expect(page.locator('.hand .card,.selected-preview .card,.hover-preview .card')).toHaveCount(0);
  expect(await page.evaluate(() => Object.hasOwn(window.__foresightReview.state.players.find(p => p.id === window.__foresightReview.me), 'hand'))).toBe(false);
  if (scroll) {
    // Every name and every card, including each group's first/last card, must
    // be fully reachable inside the actual clipped scrollport.
    const reached = await panel.evaluate(panel => {
      const nodes = [...panel.querySelectorAll('h3,.foresight-cards .card')];
      const sticky = getComputedStyle(panel.querySelector('header')).position === 'sticky' ? panel.querySelector('header').offsetHeight : 0;
      for (const node of nodes) {
        const box = node.getBoundingClientRect(), outer = panel.getBoundingClientRect();
        panel.scrollTop += box.top - outer.top - panel.clientTop - sticky;
        const final = node.getBoundingClientRect();
        if (final.top < outer.top + panel.clientTop + sticky - 1 || final.bottom > outer.top + panel.clientTop + panel.clientHeight + 1) return { ok: false, text: node.getAttribute('aria-label') || node.textContent, final: { top: final.top, bottom: final.bottom }, panel: { top: outer.top, bottom: outer.bottom }, sticky };
      }
      panel.scrollTop = 0; return { ok: true, nodes: nodes.length };
    });
    expect(reached, label).toMatchObject({ ok: true });
  }
  const actionable = await page.locator('[data-bid]').count() ? page.locator('[data-bid]').first() : null;
  if (actionable) {
    const hit = await actionable.evaluate(node => { const r = node.getBoundingClientRect(); return node.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)); });
    expect(hit, `${label} prediction must accept input`).toBe(true);
  }
  return { label, width: g.width, height: g.height, panel: g.panel, groups: g.groups.length };
}
async function verifyCards(page, expected, mode) {
  const actual = await page.locator('.foresight-player').evaluateAll(groups => groups.map(group => ({ id: group.dataset.foresightPlayer, cards: [...group.querySelectorAll('[data-visible-card]')].map(card => card.dataset.visibleCard) })));
  expect(actual).toEqual(expected.players.filter(p => p.id !== 'p0').map(p => ({ id: p.id, cards: sortCards(p.hand, mode).map(c => c.id) })));
  const ids = actual.flatMap(group => group.cards); expect(new Set(ids).size).toBe(ids.length);
}
async function sortAndRecover(page, saved, defaultMode) {
  const before = await page.evaluate(() => JSON.stringify(window.__foresightReview.game));
  await expect(page.locator('.foresight-hands')).toHaveAttribute('data-sort', defaultMode);
  await verifyCards(page, saved.game, defaultMode);
  const alternate = defaultMode === 'suit' ? 'rank' : 'suit';
  await page.locator('#foresight-sort').click();
  await verifyCards(page, saved.game, alternate);
  expect(await page.evaluate(() => JSON.stringify(window.__foresightReview.game))).toBe(before);
  await page.reload(); await page.waitForFunction(() => !!window.__foresightReview);
  await page.evaluate(() => window.__foresightReview.clear()); await settle(page);
  await expect(page.locator('.foresight-hands')).toHaveAttribute('data-sort', alternate);
  await verifyCards(page, saved.game, alternate);
  await expect(page.locator('.concealed-hand')).toHaveText('手牌暂时保密，全员预测后揭晓');
}
async function nativeScroll(page) {
  const panel = page.locator('.foresight-hands'), box = await panel.boundingBox();
  expect(await panel.evaluate(node => node.scrollHeight > node.clientHeight)).toBe(true);
  // Real browser wheel input while the pointer is over a card; no focus/click.
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 65);
  await expect.poll(() => panel.evaluate(node => node.scrollTop)).toBeGreaterThan(0);
  const start = await panel.evaluate(node => node.scrollTop);
  for (let i = 0; i < 12; i++) await page.mouse.wheel(0, 9); // touchpad-sized deltas
  await expect.poll(() => panel.evaluate(node => node.scrollTop)).toBeGreaterThan(start);
  await panel.focus(); await page.keyboard.press('End');
  await expect.poll(() => panel.evaluate(node => Math.abs(node.scrollHeight - node.clientHeight - node.scrollTop))).toBeLessThanOrEqual(1);
  await page.keyboard.press('Home'); await expect.poll(() => panel.evaluate(node => node.scrollTop)).toBe(0);
  await page.keyboard.press('PageDown'); await expect.poll(() => panel.evaluate(node => node.scrollTop)).toBeGreaterThan(0);
  await page.keyboard.press('Home');
}
async function nativeTouch(page) {
  const panel = page.locator('.foresight-hands'), box = await panel.boundingBox();
  const session = await page.context().newCDPSession(page), x = box.x + box.width / 2, y = box.y + box.height - 30;
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (let move = 1; move <= 6; move++) await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - move * 20 }] });
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect.poll(() => panel.evaluate(node => node.scrollTop)).toBeGreaterThan(0);
  await session.detach();
  // A native touch release can keep scrolling after dispatchTouchEvent returns.
  // Let momentum settle before testing snapshot scroll restoration.
  await panel.evaluate(node => new Promise(resolve => {
    let last=node.scrollTop, stable=0;
    const sample=()=>{const next=node.scrollTop;stable=next===last?stable+1:0;last=next;if(stable>=5)resolve();else requestAnimationFrame(sample);};
    requestAnimationFrame(sample);
  }));
}
async function finishPrediction(page, count) {
  const cardCount = await page.locator('.foresight-hands .card').count();
  const waitingForOthers = await page.evaluate(() => window.__foresightReview.state.players.some(p => p.id !== window.__foresightReview.me && !p.bidSubmitted));
  await page.locator('[data-bid]').first().click();
  if (waitingForOthers) {
    await expect(page.locator('.foresight-hands .card')).toHaveCount(cardCount);
    await expect(page.locator('.concealed-hand')).toBeVisible();
    await expect(page.locator('.hand .card')).toHaveCount(0);
    await verifyLayout(page, 'own-bid-locked-others-pending');
  }
  await page.evaluate(() => window.__foresightReview.finishBids()); await settle(page);
  await expect(page.locator('.foresight-hands,.concealed-hand')).toHaveCount(0);
  await expect(page.locator('.hand .card')).toHaveCount(count);
  expect(await page.evaluate(() => window.__foresightReview.state.players.filter(p => p.id !== window.__foresightReview.me).every(p => !Object.hasOwn(p, 'hand')))).toBe(true);
}

try {
  const cases = process.argv.includes('--quick') ? [[6, 10, 'standard', 'hidden']] : [
    [3, 1, 'standard', 'public'], [4, 1, 'standard', 'hidden'], [6, 1, 'standard', 'secret'],
    [3, 20, 'standard', 'hidden'], [4, 15, 'standard', 'secret'], [6, 10, 'standard', 'public'],
    [3, 4, 'mono', 'hidden'], [4, 15, 'mono', 'secret'],
  ];
  const sizes = [[1440, 900], [1280, 720], [390, 844], [320, 568], [360, 640], [844, 390], [568, 320], [844, 300], [844, 280], [768, 1024]];
  for (const [count, cards, deckMode, predictionMode] of cases) {
    const saved = fixture(count, cards, deckMode, predictionMode);
    const mode = count === 4 ? 'rank' : 'suit';
    const { context, page } = await open(saved, 1440, 900, { handSort: mode });
    try {
      for (const [width, height] of sizes) {
        await page.setViewportSize({ width, height });
        const label = `${count}p-${cards}cards-${deckMode}-${predictionMode}-${width}x${height}`;
        try {
          checks.push(await verifyLayout(page, label)); await verifyCards(page, saved.game, mode);
          if (cards > 1 || width === 320) await page.screenshot({ path: `${out}/${label}.png` });
        } catch (error) {
          await page.screenshot({ path: `${out}/FAIL-${label}.png` }); failures.push({ label, error: error.message });
          if (process.argv.includes('--quick')) throw error;
        }
      }
      await page.setViewportSize({ width: 390, height: 844 });
      await sortAndRecover(page, saved, mode);
      await page.setViewportSize({ width: 844, height: 390 }); await verifyLayout(page, 'sorted-landscape');
      await page.setViewportSize({ width: 390, height: 844 }); await verifyLayout(page, 'sorted-portrait');
      await finishPrediction(page, cards);
      checks.push({ count, cards, deckMode, predictionMode, sorting: true, refresh: true, rotation: true, revealAfterAllOnly: true });
    } finally { await context.close(); }
  }
  for (const count of [3, 4, 6]) {
    const saved = fixture(count, null, 'standard', 'hidden', 'trump');
    const { context, page } = await open(saved, 390, 844);
    try {
      for (const [width, height] of [[390, 844], [568, 320], [844, 300], [844, 280]]) {
        await page.setViewportSize({ width, height });
        await settle(page); await page.screenshot({ path: `${out}/${count}p-trump-${width}x${height}.png` });
        checks.push(await verifyLayout(page, `${count}p-trump-${width}x${height}`));
        for (const button of await page.locator('[data-trump]').all()) {
          await button.scrollIntoViewIfNeeded();
          expect(await button.evaluate(node => { const r = node.getBoundingClientRect(); return r.height >= 44 && node.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)); })).toBe(true);
        }
      }
    } finally { await context.close(); }
  }
  const saved = fixture(6, 10);
  const { context, page } = await open(saved, 1440, 900, { graphics: true });
  try {
    await page.waitForFunction(() => document.body.classList.contains('has-webgl'));
    await nativeScroll(page); await verifyLayout(page, 'desktop-native-scroll-3D');
    await page.screenshot({ path: `${out}/desktop-wheel-3D.png` });
    checks.push({ nativeWheel: true, smallTouchpadDeltas: true, keyboard: ['Home', 'End', 'PageDown'], webgl: true });
  } finally { await context.close(); }
  const mobile = await open(saved, 390, 844, { graphics: true });
  try {
    await mobile.page.waitForFunction(() => document.body.classList.contains('has-webgl'));
    await nativeTouch(mobile.page);
    // Incoming prediction snapshots retain the current scroll/focus and IDs.
    await mobile.page.locator('.foresight-hands').evaluate(node => { node.scrollTop = 80; node.focus(); });
    expect(await mobile.page.evaluate(() => window.__foresightReview.submitOther())).toBe(true);
    await settle(mobile.page);
    expect(await mobile.page.locator('.foresight-hands').evaluate(node => Math.abs(node.scrollTop - 80))).toBeLessThanOrEqual(1);
    await expect(mobile.page.locator('.foresight-hands')).toBeFocused();
    await verifyCards(mobile.page, saved.game, 'suit');
    checks.push(await verifyLayout(mobile.page, 'mobile-native-touch-3D'));
    await mobile.page.screenshot({ path: `${out}/mobile-touch-3D.png` });
    checks.push({ nativeTouch: true, snapshotRetainsScrollAndFocus: true, mobileWebgl: true });
  } finally { await mobile.context.close(); }
  expect(failures).toEqual([]); expect(errors).toEqual([]);
  console.log(JSON.stringify({ checks: checks.length, errors, failures }));
} finally {
  fs.writeFileSync(`${out}/results.json`, JSON.stringify({ checks, errors, failures }, null, 2));
  await browser.close();
}
