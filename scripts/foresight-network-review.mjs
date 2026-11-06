// Local/manual: production bundle, isolated Node/SQLite backend, real sockets.
import { chromium, expect } from '@playwright/test';
import fs from 'node:fs';
import { createServer } from '../server/index.js';
import { sortCards } from '../src/hand-model.js';

const port = Number(process.env.REVIEW_PORT || 8798), base = `http://127.0.0.1:${port}/`;
const out = 'output/playwright/foresight'; fs.mkdirSync(out, { recursive: true });
const errors = [], messages = [], checks = [];
const application = await createServer({ host: '127.0.0.1', port, databasePath: ':memory:', env: {}, onError: error => errors.push(error.message) });
await application.listen();
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'chrome', headless: true, args: ['--disable-webgl'] });
const session = page => page.evaluate(() => JSON.parse(sessionStorage.getItem('wizard-room-session:aliyun')));
const connected = page => page.locator('body[data-connection="connected"]').waitFor();
const visibleCards = page => page.locator('.foresight-player').evaluateAll(groups => groups.map(group => ({ id: group.dataset.foresightPlayer, cards: [...group.querySelectorAll('[data-visible-card]')].map(card => card.dataset.visibleCard) })));
async function verify(page, mode) {
  const saved = await session(page), { state, me } = saved;
  expect(state.foresightActive).toBe(true); expect(saved.game).toBeUndefined();
  expect(state.players.find(p => p.id === me).hand).toBeUndefined();
  expect(state.players.filter(p => p.id !== me).every(p => Array.isArray(p.hand))).toBe(true);
  await expect(page.locator('.hand .card,.selected-preview .card')).toHaveCount(0);
  await expect(page.locator('.foresight-hands')).toHaveAttribute('data-sort', mode);
  expect(await visibleCards(page)).toEqual(state.players.filter(p => p.id !== me).map(p => ({ id: p.id, cards: sortCards(p.hand, mode).map(c => c.id) })));
  return { cards: await visibleCards(page), identity: me, phase: state.phase };
}
try {
  const pages = [];
  for (const [i, viewport] of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }].entries()) {
    const context = await browser.newContext({ viewport, hasTouch: i > 0, reducedMotion: 'reduce' });
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    page.on('pageerror', error => errors.push(error.message));
    page.on('websocket', socket => socket.on('framereceived', frame => {
      try { const envelope = JSON.parse(String(frame.payload)), message = envelope.type === 'data' ? envelope.data : envelope;
        if (message.type === 'state') messages.push({ index: i, state: message.state }); } catch {}
    }));
    await page.goto(base); await page.locator('#nickname').fill(['预言房主', '手机访客', '横屏访客'][i]); pages.push(page);
  }
  const [host, guest, other] = pages;
  await host.locator('#create').click(); await connected(host);
  const room = await host.locator('.room-code').innerText();
  for (const page of [guest, other]) {
    await page.locator('#join-menu').click(); await page.locator('#room-input').fill(room); await page.locator('#join').click(); await connected(page);
  }
  await expect.poll(async () => (await session(host)).state.players.length).toBe(3);
  await host.locator('#rule-extras > summary').click();
  for (const [key, value] of Object.entries({ predictionMode: 'secret', foresight: true, short: true })) await host.locator(`input[name="${key}"][value="${value}"]`).check();
  await host.locator('#start').click();
  for (const page of pages) await page.locator('.foresight-hands').waitFor();
  for (const page of pages) if (await page.locator('[data-trump]').count()) await page.locator('[data-trump]').first().click();
  for (const page of pages) await expect.poll(async () => (await session(page)).state.phase).toBe('bid');
  const initial = await Promise.all(pages.map(page => verify(page, 'suit')));
  await guest.locator('#foresight-sort').click();
  expect(await verify(guest, 'rank')).toEqual(initial[1]);
  await verify(host, 'suit'); await verify(other, 'suit');
  // Reload creates a fresh authenticated WebSocket and permission-filtered view.
  await guest.reload(); await connected(guest); await guest.locator('.foresight-hands').waitFor();
  expect(await verify(guest, 'rank')).toEqual(initial[1]);
  await guest.setViewportSize({ width: 844, height: 390 });
  expect(await verify(guest, 'rank')).toEqual(initial[1]);
  await guest.setViewportSize({ width: 390, height: 844 });
  expect(await verify(guest, 'rank')).toEqual(initial[1]);
  const spectator = await browser.newPage({ viewport: { width: 390, height: 844 } });
  spectator.on('pageerror', error => errors.push(error.message));
  await spectator.goto(`${base}?room=${room}&watch=1`); await connected(spectator);
  expect((await session(spectator)).state.players.every(p => !Object.hasOwn(p, 'hand'))).toBe(true);
  await expect(spectator.locator('.foresight-hands,.hand .card')).toHaveCount(0);
  await host.locator('[data-bid]').first().click();
  for (const page of pages) await verify(page, page === guest ? 'rank' : 'suit');
  await expect(guest.locator(`.player[data-player="${initial[0].identity}"] .prediction > span`).last()).toHaveAttribute('aria-label','预测已锁定，未公开');
  // A new snapshot must retain the scroll/focus and the local sort choice.
  await guest.reload(); await connected(guest); await guest.locator('.foresight-hands').waitFor(); await verify(guest, 'rank');
  await guest.locator('[data-bid]').first().click();
  await verify(guest, 'rank'); await expect(guest.locator('.concealed-hand')).toBeVisible();
  await other.locator('[data-bid]').first().click();
  for (const page of pages) {
    await expect(page.locator('.foresight-hands,.concealed-hand')).toHaveCount(0);
    await expect(page.locator('.hand .card')).toHaveCount(1);
    const saved = await session(page);
    expect(saved.state.players.filter(p => p.id !== saved.me).every(p => !Object.hasOwn(p, 'hand') && p.bid == null)).toBe(true);
  }
  for (const { index, state } of messages.filter(message => message.state.foresightActive)) {
    expect(state.players[index].hand, 'Own hand must never arrive over a foresight socket').toBeUndefined();
    expect(state.players.filter((_, i) => i !== index).every(p => Array.isArray(p.hand))).toBe(true);
  }
  // Complete a real round through the unchanged select/confirm action, then
  // observe the authority's automatic next deal on players and spectator.
  for (let played = 0; played < 3; played++) {
    const current = await session(host);
    const actorId = current.state.players[current.state.turn].id;
    const actor = pages.find((_, index) => initial[index].identity === actorId);
    const saved = await session(actor);
    await actor.locator(`.hand [data-card="${saved.state.legal[0]}"]`).click();
    await expect(actor.locator('#confirm-play')).toBeEnabled();
    await actor.locator('#confirm-play').click();
    await expect.poll(async () => (await session(host)).state.trick.length).toBe(played + 1);
  }
  for (const page of [...pages,spectator]) {
    await expect(page.locator('.table-result')).toBeVisible();
    await expect(page.locator('.round-settlement,#next')).toHaveCount(0);
  }
  await host.screenshot({path:`${out}/round-result-desktop.png`});
  await guest.screenshot({path:`${out}/round-result-phone.png`});
  const result = (await session(host)).state.history;
  for (const page of [...pages,spectator]) await expect.poll(async () => (await session(page)).state.round).toBe(2);
  expect((await session(host)).state.history).toEqual(result);
  expect((await session(spectator)).state.players.every(p=>!Object.hasOwn(p,'hand'))).toBe(true);
  await expect(spectator.locator('[data-bid],#confirm-play,#hand-expand,#room-pause')).toHaveCount(0);
  // Unread count and short-lived bubbles remain available with the closed chat.
  await host.locator('#chat-toggle').click();await host.locator('#chat-input').fill('下一轮见');
  await host.locator('#chat-form button').click();await host.locator('#close-chat').click();
  await expect(guest.locator('#chat-toggle .chat-unread')).toHaveText('1');
  await expect(guest.locator('.chat-notice').last()).toContainText('下一轮见');
  await guest.locator('#chat-toggle').click();await expect(guest.locator('#chat-toggle .chat-unread')).toHaveCount(0);
  await guest.locator('#chat-input').fill('键盘草稿');
  for (const viewport of [{width:390,height:220},{width:844,height:220},{width:390,height:844}]) {
    await guest.setViewportSize(viewport);
    await expect(guest.locator('#chat-input')).toHaveValue('键盘草稿');
    const reachable = await guest.locator('#chat-form').evaluate(form => [...form.querySelectorAll('input,button')].every(node=>{
      const r=node.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight&&node.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2));
    }));
    expect(reachable,`chat composer inside ${viewport.width}x${viewport.height}`).toBe(true);
    if(viewport.height===220)await guest.screenshot({path:`${out}/chat-keyboard-${viewport.width}.png`});
  }
  await guest.locator('#close-chat').click();await expect(guest.locator('#room-chat')).toBeHidden();
  checks.push({automaticRoundAfterAnimation:true,oneScorePerRound:true,selectThenConfirm:true,unreadBadge:true,chatBubble:true,keyboardDraft:true,keyboardComposerReachable:true});
  expect(messages.some(message => message.state.foresightActive)).toBe(true);
  expect(errors).toEqual([]);
  checks.push({ independentPlayers: 3, realWebSockets: true, guestReconnectBeforeAndAfterBid: true, sortIsLocal: true, rotation: true,
    ownCardsNeverReceivedEarly: true, submittedStatusVisible: true, allBidsRevealOnlyOwnHand: true, spectatorPrivacy: true });
  console.log(JSON.stringify({ checks, stateFrames: messages.length, errors }));
} finally {
  fs.writeFileSync(`${out}/network-results.json`, JSON.stringify({ checks, stateFrames: messages.length, errors }, null, 2));
  await browser.close(); await application.close();
}
