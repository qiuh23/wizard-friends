import { chromium, expect } from '@playwright/test';
import fs from 'node:fs';

// Local/manual: real Durable Objects and legal actions. Renderer references are
// exposed only by browser response interception, never by production endpoints.
const base = process.env.GAME_URL || 'http://127.0.0.1:5173/';
const relay = process.env.RELAY_URL || 'http://127.0.0.1:8787/';
const out = 'output/playwright'; fs.mkdirSync(out, { recursive: true });
const room = Array.from(crypto.getRandomValues(new Uint8Array(8)), n => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[n & 31]).join('');
const errors = [], checks = [], clients = [], pages = [];
let closing = false;
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'chrome', headless: true });
const saved = page => page.evaluate(() => JSON.parse(sessionStorage.getItem('wizard-room-session') || 'null'));
async function client(host, token = crypto.randomUUID()) {
  const url = new URL(`/api/rooms/${room}/ws`, relay); url.protocol = 'ws:';
  const ws = new WebSocket(url), result = { ws, token, host };
  clients.push(result);
  ws.addEventListener('message', event => {
    if (event.data === 'pong') return;
    const message = JSON.parse(event.data);
    if (message.type === 'data' && message.data.type === 'state') result.state = message.data.state;
    if (message.type === 'fatal') result.terminal = true;
    if (message.type === 'data' && message.data.type === 'error' || message.type === 'fatal' && !closing) errors.push(message.data?.message || message.message);
  });
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }); });
  ws.send(JSON.stringify({ type: 'hello', version: 2, host, token, name: host ? '连贯性房主' : '联机访客' }));
  await expect.poll(() => !!result.state, { timeout: 15000 }).toBe(true);
  result.heartbeat = setInterval(() => ws.readyState === 1 && ws.send('ping'), 20000);
  result.send = async data => {
    const before = result.state;
    ws.send(JSON.stringify({ type: 'send', data }));
    await expect.poll(() => data.type === 'dissolve' ? result.terminal : result.state !== before, { timeout: 10000 }).toBe(true);
  };
  return result;
}
async function open(width, height, webgl) {
  const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'no-preference', hasTouch: width < 851 });
  await context.addInitScript(webgl => {
    localStorage.setItem('wizard-trump-motion', 'false');
    localStorage.setItem('wizard-low-graphics', 'true');
    localStorage.setItem('wizard-turn-sound', 'false');
    if (!webgl) {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function(kind, ...args) { return kind.startsWith('webgl') ? null : original.call(this, kind, ...args); };
    }
  }, webgl);
  const page = await context.newPage(); pages.push(page); page.setDefaultTimeout(15000);
  page.on('dialog', dialog => dialog.accept()); page.on('pageerror', e => errors.push(e.message));
  await page.route(/\/src\/main\.js(?:\?|$)/, async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()).replace('const tableMotion = new TableMotion();', 'const tableMotion = new TableMotion();window.__reviewMotion=tableMotion;') });
  });
  await page.route(/\/src\/table-scene\.js(?:\?|$)/, async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()).replace('this.animate(0);', 'window.__reviewScene=this;this.animate(0);') });
  });
  await page.goto(base);
  return page;
}
async function inspect(page) {
  return page.evaluate(() => {
    const record = JSON.parse(sessionStorage.getItem('wizard-room-session'));
    const state = record.state;
    const scene = window.__reviewScene;
    return { phase: document.body.dataset.phase, round: state.round, turn: state.turn,
      paused: state.lifecycle.paused,
      cards: state.trick.map(({ card, player }, index) => {
        const node = document.querySelectorAll('.played .card')[index];
        const group = scene?.cards.get(card.id), pose = window.__reviewMotion.pose(card.id);
        return { id: card.id, player, pose, enterMs: window.__reviewMotion.timing(card.id).enterMs,
          label: node?.parentElement.querySelector('.played-name')?.textContent,
          opacity: node && Number(getComputedStyle(node).opacity),
          animations: node?.getAnimations().map(a => ({ name: a.animationName, state: a.playState, delay: a.effect.getTiming().delay, time: a.currentTime })),
          mesh: group && { visible: group.visible, scale: group.scale.x / group.userData.baseScale.x,
            distance: group.position.distanceTo(group.userData.target), opacity: group.userData.face.material.opacity },
        };
      }),
      domCards: document.querySelectorAll('.played .card').length,
      meshCards: scene?.cards.size,
      overflow: document.documentElement.scrollWidth > innerWidth,
    };
  });
}
try {
  let host = await client(true);
  const home = await open(1440, 900, true), guest = await open(390, 844, false);
  const row = page => page.locator(`.room-directory-item[data-room="${room}"]`);
  for (const page of [home, guest]) {
    await expect(row(page)).toContainText('等待开局');
    await expect(row(page).locator('button')).toHaveText('加入房间');
  }
  for (const page of [home, guest]) {
    await page.locator('.room-directory').scrollIntoViewIfNeeded();
    const visible = await page.locator('.room-directory').evaluate(el => {
      const list = el.querySelector('.room-directory-list'); list.scrollTop = 0;
      const box = list.getBoundingClientRect(), button = list.querySelector('button').getBoundingClientRect();
      return button.top >= box.top && button.bottom <= box.bottom + 1;
    });
    expect(visible).toBe(true);
  }
  await guest.screenshot({ path: `${out}/online-room-directory-mobile.png`, fullPage: true });
  // Offline saved lobbies must not look joinable; the same owner can return.
  const hostToken = host.token; host.ws.close();
  await expect(row(home)).toHaveCount(0);
  host = await client(true, hostToken);
  await expect(row(home)).toContainText('等待开局');
  await guest.locator('#nickname').fill('手机玩家');
  await row(guest).locator('button').click();
  await guest.locator('.seats').waitFor();
  const other = await client(false);
  await expect.poll(() => host.state.players.length).toBe(3);
  for (let i = 0; i < 3; i++) await host.send({ type: 'addbot' });
  await expect(row(home).locator('button')).toHaveText('满员 · 进入观战');
  for (const bot of host.state.players.filter(p => p.bot)) await host.send({ type: 'remove', id: bot.id });
  await expect(row(home).locator('button')).toHaveText('加入房间');
  await home.locator('#refresh-rooms').click();
  await expect(row(home)).toContainText('3 人牌局');
  await home.screenshot({ path: `${out}/online-room-directory-desktop.png`, fullPage: true });
  checks.push('waiting-room publication, direct join, full-room action, owner reconnect and refresh');

  await host.send({ type: 'action', action: { type: 'start' } });
  await expect(row(home).locator('button')).toHaveText('进入观战');
  await row(home).locator('button').click();
  await home.waitForFunction(() => window.__reviewScene?.mode === 'game');
  await expect.poll(async () => (await saved(home))?.state.spectator).toBe(true);
  expect((await saved(home)).state.players.every(p => p.hand === undefined)).toBe(true);
  checks.push('waiting-to-playing action switch and read-only spectator privacy');

  async function act() {
    const state = host.state;
    await expect.poll(() => other.state.eventSeq).toBe(state.eventSeq);
    const guestRecord = await saved(guest);
    const all = [host, other, { state: guestRecord.state, browser: guest }];
    const current = state.phase === 'bid' ? all.find(c => c.state.canBid)
      : all.find(c => c.state.players[state.turn].hand !== undefined);
    if (!current) throw Error(`No actor in ${state.phase}`);
    const view = current.state;
    const action = state.phase === 'trump' ? { type: 'trump', suit: 'blue' }
      : state.phase === 'bid' ? { type: 'bid', value: view.bids[0] }
      : { type: 'play', card: view.legal[0] };
    const seq = state.eventSeq;
    if (current.browser) {
      if (action.type === 'trump') await guest.locator('[data-trump]').first().click();
      else if (action.type === 'bid') await guest.locator(`[data-bid="${action.value}"]`).click();
      else {
        await guest.locator(`.hand [data-card="${action.card}"]`).click();
        await guest.locator('#confirm-play').click();
      }
      await expect.poll(() => host.state.eventSeq).toBeGreaterThan(seq);
    } else await current.send({ type: 'action', action });
    await expect.poll(async () => (await saved(guest)).state.eventSeq).toBe(host.state.eventSeq);
    await expect.poll(async () => (await saved(home)).state.eventSeq).toBe(host.state.eventSeq);
  }
  for (let step = 0; step < 15 && host.state.phase !== 'roundEnd'; step++) await act();
  expect(host.state.phase).toBe('roundEnd');
  for (const page of [home, guest]) {
    const before = await inspect(page);
    expect(before.cards).toHaveLength(3); expect(before.phase).toBe('roundEnd');
    await page.waitForTimeout(550);
    expect((await inspect(page)).cards.every(c => c.pose.collect === 0)).toBe(true);
    const close = page.locator('.close-scores'); if (await close.isVisible()) await close.click();
  }
  await host.send({ type: 'action', action: { type: 'next' } });
  for (let step = 0; step < 8 && host.state.phase !== 'play'; step++) await act();
  await act();
  const id = host.state.trick[0].card.id;
  const before = await inspect(home);
  await host.send({ type: 'action', action: { type: 'chat', text: '动画中同步聊天' } });
  await Promise.all([home, guest].map(page => page.evaluate(() => dispatchEvent(new Event('resize')))));
  await home.waitForTimeout(140);
  for (const page of [home, guest]) {
    const during = await inspect(page);
    expect(during.cards[0].id).toBe(id);
    expect(during.cards[0].enterMs).toBeGreaterThanOrEqual(before.cards[0].enterMs);
    expect(during.cards[0].label).toBe(host.state.players[host.state.trick[0].player].name);
    expect(during.overflow).toBe(false);
  }
  await home.waitForTimeout(450);
  expect((await inspect(home)).cards[0].mesh.distance).toBeLessThan(.001);
  checks.push('last-round result, next-round bidding, card arrival survives chat and resize, stable identity labels');
  for (let step = 0; step < 4 && host.state.phase === 'play'; step++) await act();
  expect(host.state.phase).toBe('trickEnd');
  await home.waitForTimeout(Math.max(0, host.state.lifecycle.nextTrickAt - Date.now() - 600));
  await host.send({ type: 'pause' });
  for (const page of [home, guest]) await expect(page.locator('body')).toHaveAttribute('data-paused', 'true');
  const paused = await inspect(home);
  expect(paused.cards[0].pose.collect).toBeGreaterThan(0);
  expect(paused.cards[0].pose.collect).toBeLessThan(1);
  await host.send({ type: 'action', action: { type: 'chat', text: '收牌中暂停并重绘' } });
  await home.setViewportSize({ width: 844, height: 390 });
  await guest.setViewportSize({ width: 844, height: 390 });
  await home.waitForTimeout(350);
  const redrawn = await inspect(home);
  expect(redrawn.cards.map(c => c.pose)).toEqual(paused.cards.map(c => c.pose));
  for (const card of redrawn.cards) expect(card.mesh.scale).toBeCloseTo(1 - .65 * card.pose.collect, 5);
  const fallback = await inspect(guest);
  expect(fallback.cards.every(c => c.animations.every(a => a.state === 'paused'))).toBe(true);
  await home.reload();
  await home.waitForFunction(() => window.__reviewScene?.mode === 'game' && window.__reviewScene.state.lifecycle.paused);
  const recovered = await inspect(home);
  expect(recovered.cards.every(c => c.pose.enter === 1)).toBe(true);
  for (let i = 0; i < 3; i++) expect(recovered.cards[i].pose.collect).toBeCloseTo(paused.cards[i].pose.collect, 2);
  await home.screenshot({ path: `${out}/animation-paused-collection-3d.png` });
  await guest.screenshot({ path: `${out}/animation-paused-collection-2d.png` });
  await host.send({ type: 'resume' });
  for (const page of [home, guest]) await expect(page.locator('body')).toHaveAttribute('data-phase', 'play', { timeout: 10000 });
  for (const page of [home, guest]) {
    const next = await inspect(page);
    expect(next.domCards).toBe(0); expect(next.cards).toHaveLength(0);
    if (next.meshCards !== undefined) expect(next.meshCards).toBe(0);
  }
  checks.push('authority-timed collection, pause during collection, 2D/3D redraw and rotation, paused reload, synchronized next trick');
  closing = true; await host.send({ type: 'dissolve' });
  for (const page of [home, guest]) await page.locator('#create').waitFor();
  await expect(row(home)).toHaveCount(0);
  checks.push('dissolved room removed from directory');
  expect(errors).toEqual([]);
  fs.writeFileSync(`${out}/room-animation-review.json`, JSON.stringify({ checks, paused, redrawn, fallback, recovered, errors }, null, 2));
  console.log(JSON.stringify({ checks, errors }));
} catch (error) {
  for (const [i, page] of pages.entries()) await page.screenshot({ path: `${out}/room-animation-failure-${i}.png` }).catch(() => {});
  console.error(JSON.stringify({ checks, errors })); throw error;
} finally {
  for (const client of clients) { clearInterval(client.heartbeat); client.ws.close(); }
  await browser.close();
}
