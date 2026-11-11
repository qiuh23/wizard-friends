import { chromium, expect } from '@playwright/test';
import fs from 'node:fs';
import { createGame, addPlayer, act, viewFor, spectatorView } from '../src/game.js';
import { createRandomStream } from '../src/random.js';
import { DEFAULT_OPTIONS } from '../src/rules-options.js';

// Exercise the production entry and existing practice recovery contract. Fixtures
// are generated through legal engine actions, never through an application API.
const base = new URL(process.env.GAME_URL || 'http://127.0.0.1:3002/');
if (base.pathname !== '/' || base.search || base.hash) throw Error('GAME_URL must be the production root entry.');
const out = 'output/playwright/react-migration';
fs.mkdirSync(out, { recursive: true });
const runtimeResponse = await fetch(new URL('runtime-config.json', base));
if (!runtimeResponse.ok) throw Error(`Runtime config unavailable: ${runtimeResponse.status}`);
const runtime = await runtimeResponse.json();
const domestic = runtime.siteEdition === 'cn';
const suffix = runtime.backendId === 'aliyun' ? ':aliyun' : '';
const sessionKey = `wizard-room-session${suffix}`;
const selectedCase = process.env.MIGRATION_CASE || 'all';
const webgl = process.env.MIGRATION_WEBGL !== '0';
const errors = [], checks = [], screenshots = [];
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'chrome', headless: true });
const viewports = [[1440, 900], [390, 844], [844, 390]];
let activePage;

function fixture({ count = 3, round = 20, phase = 'play', predictionMode = 'public', foresight = false, selfTurn = true } = {}) {
  const game = createGame(runtime.siteEdition);
  game.randomState = createRandomStream(Array(11).fill(14));
  for (let i = 0; i < count; i++) addPlayer(game, `p${i}`, ['青岚', '云舒', '风行', '清月', '星河', '林语'][i]);
  act(game, 'p0', { type: 'start', options: { ...DEFAULT_OPTIONS, predictionMode, foresight } });
  for (let step = 0; step < 30000; step++) {
    if (game.round >= round && game.phase === phase && (!selfTurn || !['play', 'trump'].includes(phase) || game.turn === 0)
      && (phase !== 'bid' || viewFor(game, 'p0').canBid)) {
      game.turnDeadline = Date.now() + 10 * 60 * 1000;
      return { version: 1, role: 'practice', room: '离线练习', me: 'p0', game, identities: {} };
    }
    const player = game.phase === 'bid' ? game.players.find(player => viewFor(game, player.id).canBid) : game.players[game.turn];
    if (game.phase === 'trump') act(game, player.id, { type: 'trump', suit: 'blue' });
    else if (game.phase === 'bid') act(game, player.id, { type: 'bid', value: viewFor(game, player.id).bids[0] });
    else if (game.phase === 'play') act(game, player.id, { type: 'play', card: viewFor(game, player.id).legal[0] });
    else if (['trickEnd', 'roundEnd'].includes(game.phase)) act(game, 'p0', { type: 'next' });
    else throw Error(`Cannot reach ${round}/${phase} from ${game.round}/${game.phase}`);
  }
  throw Error('Fixture did not converge.');
}

async function contextPage(width, height, record, useWebGL = webgl) {
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: width < 851, isMobile: width < 600, reducedMotion: 'reduce' });
  await context.addInitScript(({ record, sessionKey, suffix, useWebGL }) => {
    if (record) {
      const anchor = Date.now();
      Date.now = () => anchor;
      record.game.turnDeadline = anchor + 45000;
      record.remainingMs = 45000;
      sessionStorage.setItem(sessionKey, JSON.stringify(record));
    }
    localStorage.setItem(`wizard-low-graphics${suffix}`, 'true');
    localStorage.setItem(`wizard-trump-motion${suffix}`, 'false');
    if (!useWebGL) {
      const get = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (kind, ...args) { return kind.startsWith('webgl') ? null : get.call(this, kind, ...args); };
    }
  }, { record, sessionKey, suffix, useWebGL });
  const page = await context.newPage(); activePage = page;
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  await page.goto(base.href, { waitUntil: 'domcontentloaded' });
  await page.locator(`${record ? '.own-status' : '#create'},#app > [role="alert"]`).first().waitFor();
  const bootError = page.locator('#app > [role="alert"]');
  if (await bootError.count()) throw Error(`Production entry failed: ${await bootError.innerText()}`);
  if (record) await expect(page.locator('#notice')).toBeEmpty({ timeout: 6000 });
  return { context, page };
}

async function screenshot(page, name) {
  await page.waitForTimeout(180);
  const file = `${out}/${domestic ? 'cn' : 'global'}-${name}.png`;
  await page.screenshot({ path: file });
  screenshots.push(file);
}

async function assertInViewport(locator, label) {
  await expect(locator, label).toBeVisible();
  const data = await locator.evaluate(node => {
    const r = node.getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: innerWidth, height: innerHeight,
      hit: node.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)) };
  });
  expect(data.left, label).toBeGreaterThanOrEqual(-1);
  expect(data.top, label).toBeGreaterThanOrEqual(-1);
  expect(data.right, label).toBeLessThanOrEqual(data.width + 1);
  expect(data.bottom, label).toBeLessThanOrEqual(data.height + 1);
  expect(data.hit, `${label}: actual center accepts input`).toBe(true);
}

async function blank(page) {
  const point = await page.locator('.table').evaluate(table => {
    const r = table.getBoundingClientRect();
    for (let y = Math.max(100, r.top + 60); y < Math.min(innerHeight - 100, r.bottom - 30); y += 20) {
      for (let x = Math.max(15, r.left + 15); x < Math.min(innerWidth - 15, r.right - 15); x += 20) {
        const node = document.elementFromPoint(x, y);
        if (node && table.contains(node) && node.matches('.table,.table-ring,.scene-host,canvas,.played-cards,.table-decor,.felt-stars')) return { x, y };
      }
    }
    throw Error('No visible blank table surface.');
  });
  if (page.viewportSize().width < 851) await page.touchscreen.tap(point.x, point.y);
  else await page.mouse.click(point.x, point.y);
}

async function selectCard(page, locator) {
  activePage = page;
  const id = await locator.getAttribute('data-card');
  await locator.scrollIntoViewIfNeeded();
  const point = await locator.evaluate(node => {
    const r = node.getBoundingClientRect();
    for (const dy of [16, 30, 8, r.height / 2, r.height - 8]) for (const dx of [8, 16, 4, r.width / 2, r.width - 6]) {
      const x = r.left + dx, y = r.top + dy;
      if (x > 0 && x < innerWidth && y > 0 && y < innerHeight && node.contains(document.elementFromPoint(x, y))) return { x, y };
    }
    return null;
  });
  expect(point, `Card ${id} exposes a real touch/click surface`).not.toBeNull();
  if (page.viewportSize().width < 851) await page.touchscreen.tap(point.x, point.y);
  else await page.mouse.click(point.x, point.y);
  try { await expect(page.locator(`.hand [data-card="${id}"]`)).toHaveClass(/selected/); }
  catch (error) {
    console.error(JSON.stringify({ selectionFailure: { card: id, viewport: page.viewportSize(), point,
      selected: await page.locator('.hand .selected').getAttribute('data-card').catch(() => null),
      phase: await page.locator('body').getAttribute('data-phase'),
      hit: await page.evaluate(({x,y}) => document.elementFromPoint(x,y)?.outerHTML.slice(0,300), point) } }));
    await page.screenshot({path:`${out}/${runtime.siteEdition}-selection-failure-${page.viewportSize().width}.png`});
    throw error;
  }
  return id;
}

async function control(page, id) {
  if (!await page.locator(id).isVisible()) await page.locator('#table-menu').click();
  await page.locator(id).click();
  if (await page.locator('#table-menu-panel').isVisible()) await page.locator('#table-menu').click();
}

async function assertDOMPrivacy(page, record) {
  const view = viewFor(record.game, record.me);
  const permitted = new Set(view.players.flatMap(player => player.hand || []).map(card => card.id));
  const publicCards = [...view.trick.map(play => play.card), view.reveal, ...(view.playedCards || []).map(play => play.card)].filter(Boolean);
  publicCards.forEach(card => permitted.add(card.id));
  const ids = await page.locator('[data-card],[data-visible-card]').evaluateAll(nodes => nodes.map(node => node.dataset.card || node.dataset.visibleCard));
  const privateIds = record.game.players.flatMap(player => player.hand).filter(card => !permitted.has(card.id)).map(card => card.id);
  expect(ids.filter(id => privateIds.includes(id)), 'No concealed card is represented in the DOM').toEqual([]);
  if (!view.foresightActive) await expect(page.locator('.foresight-hands')).toHaveCount(0);
  if (view.options.predictionMode === 'secret' && ['bid', 'play', 'trickEnd'].includes(view.phase)) {
    for (const opponent of view.players.filter(player => player.id !== record.me && player.bidSubmitted)) {
      await expect(page.locator(`[data-player="${opponent.id}"] .target-secret`)).toBeVisible();
      expect(await page.locator(`[data-player="${opponent.id}"] .prediction`).innerText()).not.toMatch(/估\s*\d/);
    }
  }
}

async function fixtures() {
  for (const [width, height] of (selectedCase === 'settlement' ? [] : viewports)) {
    console.log(`[migration] ${runtime.siteEdition} 20-card hand ${width}x${height}`);
    const record = fixture();
    const { context, page } = await contextPage(width, height, record);
    const label = `${width}x${height}`;
    await expect(page.locator('.hand [data-card]')).toHaveCount(20);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    await assertInViewport(page.locator('#confirm-play'), `${label}: confirm play`);
    await assertDOMPrivacy(page, record);
    await screenshot(page, `table-${label}`);
    let nativeTouchScroll = null;
    if (width < 851 && await page.locator('.hand').evaluate(node => node.scrollWidth > node.clientWidth + 10)) {
      const cdp = await context.newCDPSession(page);
      const point = await page.locator('.hand').evaluate(node => {
        const r = node.getBoundingClientRect();
        return { x: Math.min(innerWidth - 30, r.right - 30), y: Math.max(20, Math.min(innerHeight - 60, r.top + 45)) };
      });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
      for (let step = 1; step <= 8; step++) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: point.x - step * 22, y: point.y }] });
        await page.waitForTimeout(20);
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await page.waitForTimeout(160);
      await expect(page.locator('.hand .selected')).toHaveCount(0);
      nativeTouchScroll = await page.locator('.hand').evaluate(node => node.scrollLeft);
      expect(nativeTouchScroll, 'Native hand swipe scrolls without selecting').toBeGreaterThan(0);
      await page.locator('.hand').evaluate(node => { node.scrollLeft = 0; });
    }
    const id = await selectCard(page, page.locator('.hand .playable').first());
    await expect(page.locator('#confirm-play')).toBeEnabled();
    if (width >= 851) {
      await page.mouse.move(10, 100);
      const fan = await page.locator('.hand').evaluate(node => ({ fan: node.classList.contains('desktop-fan'),
        poses: [...node.querySelectorAll('[data-card]')].map(card => ({ id: card.dataset.card,
          lift: parseFloat(card.style.getPropertyValue('--hand-lift')),
          push: parseFloat(card.style.getPropertyValue('--hand-push')) })) }));
      expect(fan.fan).toBe(true);
      expect(fan.poses.find(pose => pose.id === id).lift).toBeLessThanOrEqual(-20);
      expect(fan.poses.some(pose => pose.id !== id && Math.abs(pose.push) >= 10), 'Adjacent cards make space').toBe(true);
    }
    await screenshot(page, `selected-${label}`);
    await control(page, '#hand-sort');
    await expect(page.locator(`.hand [data-card="${id}"]`)).toHaveClass(/selected/);
    await control(page, '#hand-expand');
    await expect(page.locator('.hand-grid [data-card]')).toHaveCount(20);
    await expect(page.locator(`.hand [data-card="${id}"]`)).toHaveClass(/selected/);
    await screenshot(page, `expanded-${label}`);
    await control(page, '#hand-expand');
    for (const [trigger, panel] of [['#table-menu', '#table-menu-panel'], ['#table-scores', '#table-score-panel']]) {
      await page.locator(trigger).click();
      await expect(page.locator(panel)).toBeVisible();
      await assertInViewport(page.locator('#confirm-play'), `${label}: action remains accessible with ${panel}`);
      await blank(page);
      await expect(page.locator(panel)).toBeHidden();
    }
    await blank(page);
    await expect(page.locator('.hand .selected')).toHaveCount(0);
    await expect(page.locator('#confirm-play')).toBeDisabled();
    await selectCard(page, page.locator('.hand .playable').first());
    await page.locator('#confirm-play').click();
    await expect(page.locator('.hand [data-card]')).toHaveCount(19);
    checks.push({ case: '20-card-hand', viewport: label, selectionLiftAndNeighborSpace: width >= 851,
      sortAndExpandPreserveSelection: true, blankDismissesFloatingLayers: true, confirmedExactlyOnce: true, domPrivacy: true, nativeTouchScroll });
    await context.close();
  }
  for (const [width, height] of (selectedCase === 'settlement' ? [] : viewports)) {
    console.log(`[migration] ${runtime.siteEdition} six-player secret ${width}x${height}`);
    const record = fixture({ count: 6, round: 10, predictionMode: 'secret' });
    const { context, page } = await contextPage(width, height, record);
    await expect(page.locator('.opponents .player')).toHaveCount(5);
    await expect(page.locator('.hand [data-card]')).toHaveCount(10);
    await assertDOMPrivacy(page, record);
    await assertInViewport(page.locator('#confirm-play'), 'Six-player confirm');
    await screenshot(page, `six-secret-${width}x${height}`);
    checks.push({ case: 'six-player-secret', viewport: `${width}x${height}`, concealedHandsAndBids: true });
    await context.close();
  }
  for (const [width, height] of (selectedCase === 'settlement' ? [] : viewports)) {
    console.log(`[migration] ${runtime.siteEdition} foresight ${width}x${height}`);
    const record = fixture({ round: 8, phase: 'bid', predictionMode: 'secret', foresight: true, selfTurn: false });
    const { context, page } = await contextPage(width, height, record);
    await expect(page.locator('.concealed-hand')).toBeVisible();
    await expect(page.locator('.hand [data-card]')).toHaveCount(0);
    await expect(page.locator('.foresight-player')).toHaveCount(2);
    await expect(page.locator('.foresight-player [data-visible-card]')).toHaveCount(16);
    await assertDOMPrivacy(page, record);
    await assertInViewport(page.locator('[data-bid]').first(), 'Foresight prediction');
    await screenshot(page, `foresight-${width}x${height}`);
    await page.locator('[data-bid]').first().click();
    await expect(page.locator('[data-bid]')).toHaveCount(0);
    checks.push({ case: 'foresight', viewport: `${width}x${height}`, ownCardsConcealed: true, otherCardsPermitted: true, prediction: true });
    await context.close();
  }
  for (const [width, height] of viewports) {
    console.log(`[migration] ${runtime.siteEdition} finished ${width}x${height}`);
    const record = fixture({ round: 20, phase: 'finished', selfTurn: false });
    const { context, page } = await contextPage(width, height, record);
    await expect(page.locator('.final-score-row')).toHaveCount(3);
    const totals = await page.locator('.final-total').evaluateAll(nodes => nodes.map(node => {
      const cell = node.getBoundingClientRect(), panel = node.closest('.final-results').getBoundingClientRect();
      return { left: cell.left, right: cell.right, visibleLeft: panel.left, visibleRight: panel.right };
    }));
    for (const cell of totals) {
      expect(cell.left, 'Final total score begins inside the first visible table area').toBeGreaterThanOrEqual(cell.visibleLeft - 1);
      expect(cell.right, 'Final total score is visible without horizontal scrolling').toBeLessThanOrEqual(cell.visibleRight + 1);
    }
    await assertInViewport(page.locator('#rematch'), 'Final result rematch');
    await screenshot(page, `finished-${width}x${height}`);
    await page.locator('#rematch').click();
    await expect(page.locator('#start')).toBeVisible();
    checks.push({ case: 'finished', viewport: `${width}x${height}`, finalRanking: true, totalScoreInFirstViewport: true, rematchReturnsToWaitingRoom: true });
    await context.close();
  }
}

const session = page => page.evaluate(key => JSON.parse(sessionStorage.getItem(key) || 'null'), sessionKey);
const state = async page => (await session(page))?.state;
async function connected(page) { await page.locator('body[data-connection="connected"]').waitFor({ timeout: 30000 }); }
async function actOnce(page, { allowPlay = true } = {}) {
  if (await page.locator('[data-trump]').count()) { await page.locator('[data-trump]').first().click(); return true; }
  if (await page.locator('[data-bid]').count()) { await page.locator('[data-bid]').first().click(); return true; }
  const saved = await session(page), view = saved?.state;
  if (allowPlay && view?.phase === 'play' && view.players[view.turn]?.id === saved.me && view.legal?.length) {
    await selectCard(page, page.locator(`.hand [data-card="${view.legal[0]}"]`));
    await page.locator('#confirm-play').click();
    await expect.poll(async () => (await state(page)).eventSeq).toBeGreaterThan(view.eventSeq);
    return true;
  }
  return false;
}

async function network() {
  console.log(`[migration] ${runtime.siteEdition} real three-client five-round game`);
  const contexts = [], pages = [], sockets = [], apiOrigins = [];
  try {
    for (let i = 0; i < 3; i++) {
      const [width, height] = viewports[i];
      const { context, page } = await contextPage(width, height, null, false);
      contexts.push(context); pages.push(page);
      context.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) apiOrigins.push(new URL(request.url()).origin); });
      page.on('websocket', socket => sockets.push(socket.url()));
      if (!domestic) await page.locator('#nickname').fill(['迁移房主', '迁移好友', '迁移巫师'][i]);
      else {
        await expect(page.locator('#nickname')).toHaveJSProperty('tagName', 'OUTPUT');
        await expect(page.locator('#random-nickname')).toBeVisible();
        await expect(page.locator('#chat-toggle,#room-chat,#rename-input')).toHaveCount(0);
      }
      await screenshot(page, `home-${width}x${height}`);
    }
    const [host, guest, other] = pages;
    await host.locator('#create').click(); await connected(host);
    const code = await host.locator('.room-code').innerText();
    for (const page of [guest, other]) {
      await page.locator('#join-menu').click(); await page.locator('#room-input').fill(code);
      await page.locator('#join').click(); await connected(page);
    }
    for (const page of pages) await expect.poll(async () => (await state(page))?.players.length).toBe(3);
    for (const page of pages) await screenshot(page, `waiting-${page.viewportSize().width}x${page.viewportSize().height}`);
    await host.locator('input[name="predictionMode"][value="secret"]').check();
    await host.locator('input[name="short"][value="true"]').check();
    await host.locator('input[name="foresight"][value="false"]').check();
    for (const page of [guest, other]) {
      if (!await page.locator('#rules-form').isVisible()) await page.locator('[data-lobby-panel="rules"]').click();
      await expect(page.locator('#rules-form input').first()).toBeDisabled();
    }
    await host.locator('#start').click();
    for (const page of pages) await page.locator('.table').waitFor();
    for (let step = 0; step < 12 && (await state(host)).phase !== 'play'; step++) {
      for (const page of pages) await actOnce(page, { allowPlay: false });
      await host.waitForTimeout(80);
    }
    await expect.poll(async () => (await state(host)).phase).toBe('play');
    for (const page of pages) {
      const saved = await session(page), view = saved.state;
      expect(saved.game).toBeUndefined(); expect(view.randomState).toBeUndefined(); expect(view.identities).toBeUndefined();
      expect(view.players.filter(player => Array.isArray(player.hand))).toHaveLength(1);
      expect(view.players.filter(player => player.id !== saved.me).every(player => player.bid == null)).toBe(true);
    }
    const spectator = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
    contexts.push(spectator);
    const watch = await spectator.newPage(); watch.on('pageerror', error => errors.push(error.message));
    await watch.goto(`${base.href}?room=${code}&watch=1`); await connected(watch);
    expect((await state(watch)).players.every(player => player.hand === undefined && player.bid == null)).toBe(true);
    await expect(watch.locator('.hand [data-card],[data-bid]')).toHaveCount(0);
    await host.locator('#room-pause').click();
    await expect.poll(async () => (await state(guest)).lifecycle?.paused).toBe(true);
    const stable = await state(host);
    const identity = { me: (await session(host)).me, players: stable.players, round: stable.round, phase: stable.phase };
    await host.reload(); await connected(host);
    const restored = await state(host);
    expect({ me: (await session(host)).me, players: restored.players, round: restored.round, phase: restored.phase }).toEqual(identity);
    const guestBeforeDrop = await session(guest);
    const guestHand = guestBeforeDrop.state.players.find(player => player.id === guestBeforeDrop.me).hand;
    await guest.context().setOffline(true);
    await expect.poll(async () => (await state(host)).players.find(player => player.id === guestBeforeDrop.me).online).toBe(false);
    await guest.context().setOffline(false); await connected(guest);
    await expect.poll(async () => (await state(host)).players.find(player => player.id === guestBeforeDrop.me).online).toBe(true);
    expect((await session(guest)).me).toBe(guestBeforeDrop.me);
    expect((await state(guest)).players.find(player => player.id === guestBeforeDrop.me).hand).toEqual(guestHand);
    if (!domestic) {
      await guest.locator('#chat-toggle').click();
      await assertInViewport(guest.locator('#chat-input'), 'Overseas chat input');
      await guest.locator('#chat-input').fill('React 迁移实测'); await guest.locator('#chat-form button').click();
      await expect(host.locator('#chat-messages')).toContainText('React 迁移实测');
      await guest.locator('#close-chat').click();
    } else for (const page of [...pages, watch]) await expect(page.locator('#chat-toggle,#room-chat,#rename-input')).toHaveCount(0);
    await host.locator('#room-pause').click();
    await expect.poll(async () => (await state(guest)).lifecycle?.paused).toBe(false);
    for (let step = 0; step < 20 && !(await state(host)).history.length; step++) {
      for (const page of pages) await actOnce(page);
      await host.waitForTimeout(80);
    }
    await expect.poll(async () => (await state(host)).history.length).toBe(1);
    const results = (await state(host)).history;
    for (const page of [...pages, watch]) await expect.poll(async () => (await state(page)).history).toEqual(results);
    await expect.poll(async () => (await state(host)).round, { timeout: 10000 }).toBe(2);
    await host.locator('#table-scores').click();
    await expect(host.locator('.score-ledger tbody tr:not(.in-progress)')).toHaveCount(1);
    await screenshot(host, 'network-scores');
    await blank(host);
    // A real departure preserves the same player's permission view on return.
    await guest.locator('#table-menu').click(); await guest.locator('#leave').click();
    await expect(guest.locator('#resume-room')).toBeVisible();
    const guestId = (await session(guest)).me;
    await guest.locator('#resume-room').click(); await connected(guest);
    expect((await session(guest)).me).toBe(guestId);
    // Finish all five quick rounds through the actual clients. The room
    // authority retains its real three-second trick/round review duration.
    for (let step = 0; step < 300 && (await state(host)).phase !== 'finished'; step++) {
      const phase = (await state(host)).phase;
      if (['trickEnd', 'roundEnd'].includes(phase)) {
        await expect.poll(async () => (await state(host)).phase, { timeout: 10000 }).not.toBe(phase);
      } else {
        for (const page of pages) await actOnce(page);
        await host.waitForTimeout(60);
      }
    }
    await expect.poll(async () => (await state(host)).phase).toBe('finished');
    const finalHistory = (await state(host)).history;
    expect(finalHistory).toHaveLength(5);
    for (const page of [...pages, watch]) {
      await expect.poll(async () => (await state(page)).history).toEqual(finalHistory);
      await expect(page.locator('.final-score-row')).toHaveCount(3);
    }
    for (const page of pages) await screenshot(page, `network-finished-${page.viewportSize().width}x${page.viewportSize().height}`);
    await host.locator('#rematch').click();
    for (const page of pages) await expect.poll(async () => (await state(page)).phase).toBe('lobby');
    expect((await state(host)).players.every(player => player.score === 0)).toBe(true);
    // Observe the ordinary lobby destination without leaving the local test for
    // an external production service; the URL must carry no room credentials.
    const lobby = domestic ? 'https://magical-athlete-online.cn/' : 'https://magical-athlete.qiuh23.workers.dev/lobby/';
    await guest.route(lobby, route => route.fulfill({ contentType: 'text/html', body: '<title>Lobby destination verified</title>' }));
    await guest.locator('#quick-settings summary').click(); await guest.locator('[data-lobby-navigation]').last().click();
    await expect.poll(() => guest.url()).toBe(lobby);
    await host.locator('#room-dissolve').click();
    for (const page of [host, other, watch]) await page.locator('#create').waitFor();
    expect(apiOrigins.every(origin => origin === base.origin), 'Observed HTTP API requests remain same-origin').toBe(true);
    expect(sockets.some(url => /\/api\/rooms\/[^/]+\/ws$/.test(new URL(url).pathname))).toBe(true);
    expect([...new Set(sockets.map(url => new URL(url).origin))]).toEqual([base.origin.replace(/^http/, 'ws')]);
    checks.push({ case: 'network', clients: 3, spectator: 1, edition: runtime.siteEdition, httpAPIRequestCount: apiOrigins.length,
      socketOrigins: [...new Set(sockets.map(url => new URL(url).origin))],
      verified: ['create/join waiting room', 'host-only rules', 'secret bid privacy', 'no host authority cache', 'spectator privacy',
        'pause/resume', 'refresh restores identity/hands/scores', 'network interruption reconnect preserves identity and hand', domestic ? 'domestic communication disabled' : 'overseas chat',
        'five quick rounds scores synchronized', 'automatic next trick/round', 'final ranking and rematch', 'leave/return keeps identity', 'same-site lobby URL without credentials',
        'dissolve', 'same-origin API/WebSocket'] });
  } catch (error) {
    for (const [index,page] of pages.entries()) await page.screenshot({path:`${out}/${runtime.siteEdition}-network-failure-${index}.png`}).catch(()=>{});
    throw error;
  } finally { for (const context of contexts) await context.close(); }
}

try {
  if (['all', 'fixtures', 'settlement'].includes(selectedCase)) await fixtures();
  if (['all', 'network'].includes(selectedCase)) await network();
  expect(errors, 'No uncaught browser errors').toEqual([]);
  const report = { status: 'passed', entry: base.href, siteEdition: runtime.siteEdition, webgl,
    fixtureClock: 'Date.now fixed in fixture browser context; 45-second play budget', networkClock: 'real, unchanged', networkGraphics: '2D',
    finishedAt: new Date().toISOString(), checks, screenshots, errors,
    limits: ['Browser viewport/touch simulation, not physical devices', 'Local transport, not production deployment or regional carrier networks'] };
  fs.writeFileSync(`${out}/${runtime.siteEdition}-report.json`, JSON.stringify(report, null, 2));
  fs.writeFileSync(`${out}/${runtime.siteEdition}-${selectedCase}-report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  await activePage?.screenshot({ path: `${out}/${runtime.siteEdition}-failure.png` }).catch(() => {});
  const report = { status: 'failed', entry: base.href, siteEdition: runtime.siteEdition, checks, screenshots, errors, failure: error.stack };
  fs.writeFileSync(`${out}/${runtime.siteEdition}-report.json`, JSON.stringify(report, null, 2));
  fs.writeFileSync(`${out}/${runtime.siteEdition}-${selectedCase}-report.json`, JSON.stringify(report, null, 2));
  throw error;
} finally { await browser.close(); }
