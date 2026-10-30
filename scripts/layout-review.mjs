import { chromium, expect } from '@playwright/test';
import fs from 'node:fs';
import { createGame, addPlayer, act, viewFor } from '../src/game.js';
import { createRandomStream } from '../src/random.js';
import { DEFAULT_OPTIONS } from '../src/rules-options.js';

// Local/manual only. Reach fixtures through legal engine actions; never expose
// test clocks, seeded games or arbitrary-state endpoints in the Worker.
const base = process.env.GAME_URL || 'http://127.0.0.1:5173/';
const out = 'output/playwright'; fs.mkdirSync(out, { recursive: true });
const wantedViewport=([width,height])=>!process.env.LAYOUT_VIEWPORT||process.env.LAYOUT_VIEWPORT===`${width}x${height}`;
function fixture(count, round) {
  const game = createGame(); game.randomState = createRandomStream(Array(11).fill(4));
  for (let i = 0; i < count; i++) addPlayer(game, `p${i}`, ['青岚', '云舒', '风行', '清月', '星河', '林语'][i]);
  const run = (id, action) => act(game, id, action);
  run('p0', { type: 'start', options: DEFAULT_OPTIONS });
  for (let i = 0; i < 10000; i++) {
    if (game.phase === 'play' && game.round === round && game.turn === 0) break;
    if (game.phase === 'trump') run(game.players[game.turn].id, { type: 'trump', suit: 'blue' });
    else if (game.phase === 'bid') {
      const id = game.players[game.turn].id;
      run(id, { type: 'bid', value: viewFor(game, id).bids[0] });
    } else if (game.phase === 'play') {
      const id = game.players[game.turn].id;
      run(id, { type: 'play', card: viewFor(game, id).legal[0] });
    } else if (['trickEnd', 'roundEnd'].includes(game.phase)) run('p0', { type: 'next' });
    else throw Error(`Unexpected fixture phase ${game.phase}`);
  }
  if (game.round !== round || game.turn !== 0) throw Error('Fixture did not reach requested round');
  game.turnDeadline = Date.now() + 30000;
  return { version: 1, role: 'practice', room: '离线练习', me: 'p0', game, identities: {} };
}
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'chrome', headless: true });
const errors = [], checks = [];
async function handControl(page, id) {
  if (!await page.locator(id).isVisible()) await page.locator('#table-menu').click();
  await page.locator(id).click();
  if (await page.locator('#table-menu-panel').isVisible()) await page.locator('#table-menu').click();
}
async function selectHandCard(page, card, touch = false) {
  const id=await card.getAttribute('data-card');
  await card.scrollIntoViewIfNeeded();
  const point=await card.evaluate(node=>{
    const r=node.getBoundingClientRect();
    for(const y of [20,35,10,r.height/2,r.height-8]) for(const x of [15,8,4,r.width/2,r.width-8]) {
      const px=r.left+x,py=r.top+y;
      if(px<0||px>=innerWidth||py<0||py>=innerHeight)continue;
      if(node.contains(document.elementFromPoint(px,py)))return {x:px,y:py,localX:x,localY:y};
    }
    return null;
  });
  expect(point,`${id}: the card must expose a real selectable surface`).not.toBeNull();
  if(touch)await page.touchscreen.tap(point.x,point.y);
  else await card.click({position:{x:point.localX,y:point.localY}});
  try { await expect(page.locator(`.hand [data-card="${id}"]`)).toHaveClass(/selected/); }
  catch(error) {
    const selected=await page.locator('.hand .selected').getAttribute('data-card').catch(()=>null);
    console.error(JSON.stringify({selectHandCard:id,point,selected,viewport:page.viewportSize()}));
    await page.screenshot({path:`${out}/hand-selection-failure-${page.viewportSize().width}.png`});throw error;
  }
}
async function screenshotStable(page, options) {
  // The retained low-power WebGL renderer draws at 20fps; let the canvas catch
  // the DOM anchor after a hand collapse, expansion or orientation change.
  await page.waitForTimeout(150);
  await page.screenshot(options);
}
async function cancelOnBlankTable(page) {
  const point=await page.locator('.table').evaluate(table=>{
    const r=table.getBoundingClientRect();
    for(let y=r.top+100;y<r.bottom-110;y+=24) for(let x=r.left+12;x<r.right-12;x+=24) {
      const target=document.elementFromPoint(x,y);
      if(target&&table.contains(target)&&target.matches('.table,.table-ring,.scene-host,canvas,.played-cards'))return {x,y};
    }
    throw Error('No unobstructed table surface for deselecting');
  });
  if(page.viewportSize().width<851)await page.touchscreen.tap(point.x,point.y);
  else await page.mouse.click(point.x,point.y);
  await expect(page.locator('.hand .selected')).toHaveCount(0);
}
async function openFixture(count, round, width, height, settle = false) {
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: width < 851,
    isMobile: width < 600, reducedMotion: 'reduce' });
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  const record = fixture(count, round);
  if (settle) while (record.game.phase === 'play') {
    const id = record.game.players[record.game.turn].id;
    act(record.game, id, { type: 'play', card: viewFor(record.game, id).legal[0] });
  }
  await context.addInitScript(saved => {
    sessionStorage.setItem('wizard-room-session', JSON.stringify(saved));
    localStorage.setItem('wizard-low-graphics', 'true');
    localStorage.setItem('wizard-trump-motion', 'false');
  }, record);
  await page.goto(base);
  await page.locator(settle ? '.own-status' : '.hand .card').first().waitFor();
  await expect(page.locator('#notice')).toBeEmpty({ timeout: 6000 });
  return { context, page };
}
async function bounds(page) {
  return page.evaluate(() => {
    const rect = el => { if(!el)return null; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
    const hand = document.querySelector('.hand');
    return { overflow: document.documentElement.scrollWidth > innerWidth,
      hand: rect(hand), scrollWidth: hand.scrollWidth, clientWidth: hand.clientWidth,
      target: rect(document.querySelector('.own-status')),
      action: rect(document.querySelector('.action-panel')),
      chat: rect(document.querySelector('#chat-toggle')),
      confirm: rect(document.querySelector('#confirm-play')),
      seats: [...document.querySelectorAll('.opponents .player')].map(rect),
      played: [...document.querySelectorAll('.played .card')].map(rect) };
  });
}
try {
  if (process.env.LAYOUT_CASE !== 'full-trick') {
  for (const [width, height] of [[1440, 900], [360, 800], [390, 844], [844, 390]].filter(wantedViewport)) {
    const { context, page } = await openFixture(3, 20, width, height);
    await expect(page.locator('.hand .card')).toHaveCount(20);
    const layout = await bounds(page); expect(layout.overflow).toBe(false);
    expect(layout.target.y).toBeGreaterThanOrEqual(0);
    expect(layout.confirm.y + layout.confirm.height).toBeLessThanOrEqual(height);
    await expect(page.locator('#confirm-play')).toBeDisabled();
    const prefix = width === 1440 ? 'desktop' : `mobile-${width}x${height}`;
    await screenshotStable(page,{ path: `${out}/${prefix}-browse.png` });
    // Native touch scroll: moving past the threshold must not select or play.
    let scroll = 0;
    if (width < 851) {
    const cdp = await context.newCDPSession(page), hand = layout.hand;
    const x = hand.x + hand.width - 25, y = hand.y + Math.min(60, hand.height / 2);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let step = 1; step <= 8; step++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x - step * 24, y }] });
      await page.waitForTimeout(20);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(150);
    await expect(page.locator('.hand .selected')).toHaveCount(0);
    await expect(page.locator('.hand .card')).toHaveCount(20);
    scroll = await page.locator('.hand').evaluate(el => el.scrollLeft);
    if (layout.scrollWidth > layout.clientWidth + 10) expect(scroll).toBeGreaterThan(0);
    } else {
      await page.locator('.hand .card').first().hover();
      await expect(page.locator('.hover-preview')).toBeHidden();
      await expect(page.locator('.hand .card.hovered')).toHaveCount(1);
      expect(await page.locator('.hand .card.hovered').evaluate(node => parseFloat(node.style.getPropertyValue('--hand-lift')))).toBeLessThan(0);
      await expect(page.locator('.hand .selected')).toHaveCount(0);
      await expect(page.locator('#confirm-play')).toBeDisabled();
      await page.mouse.move(20, 100);
    }
    // Return to the first visible card, then select without submitting.
    await page.locator('.hand').evaluate(el => { el.scrollLeft = 0; });
    await selectHandCard(page,page.locator('.hand .playable').first(),width<851);
    await expect(page.locator('.hand .selected')).toHaveCount(1);
    if (width >= 851 && await page.locator('.hand').evaluate(node => node.classList.contains('desktop-fan'))) {
      await expect(page.locator('.selected-preview')).toBeHidden();
      expect(await page.locator('.hand .selected').evaluate(node => parseFloat(node.style.getPropertyValue('--hand-lift')))).toBeLessThan(-20);
    } else if(await page.locator('body').getAttribute('data-table-layout')==='strip') await expect(page.locator('.selected-preview')).toBeHidden();
    else await expect(page.locator('.selected-preview')).toBeVisible();
    await expect(page.locator('#confirm-play')).toBeEnabled();
    await screenshotStable(page,{ path: `${out}/${prefix}-selected.png` });
    const selected = await page.locator('.hand .selected').getAttribute('data-card');
    await handControl(page, '#hand-sort');
    await expect(page.locator(`.hand [data-card="${selected}"]`)).toHaveClass(/selected/);
    await expect(page.locator('.hand .card')).toHaveCount(20);
    await handControl(page, '#hand-expand');
    await expect(page.locator('.hand-grid .card')).toHaveCount(20);
    await expect(page.locator(`.hand [data-card="${selected}"]`)).toHaveClass(/selected/);
    await screenshotStable(page,{ path: `${out}/${prefix}-expanded.png` });
    await handControl(page, '#hand-expand');
    await cancelOnBlankTable(page);
    await expect(page.locator('#confirm-play')).toBeDisabled();
    await selectHandCard(page,page.locator('.hand .playable').first(),width<851);
    await page.locator('#confirm-play').click();
    await expect(page.locator('.hand .card')).toHaveCount(19);
    checks.push({ width, height, cards: 20, layout, nativeTouchScroll: scroll, selected, confirmedExactlyOnce: true });
    await context.close();
  }
  for (const round of [1, 15]) for (const width of [1440, 390]) {
    if(!wantedViewport([width,width===390?844:900]))continue;
    const { context, page } = await openFixture(3, round, width, width === 390 ? 844 : 900);
    await expect(page.locator('.hand .card')).toHaveCount(round);
    await selectHandCard(page,page.locator('.hand .playable').first(),width<851);
    const id = await page.locator('.hand .selected').getAttribute('data-card');
    await handControl(page, '#hand-sort');
    await expect(page.locator(`.hand [data-card="${id}"]`)).toHaveClass(/selected/);
    await cancelOnBlankTable(page);
    await expect(page.locator('#confirm-play')).toBeDisabled();
    await screenshotStable(page,{ path: `${out}/hand-${round}-${width}.png` });
    checks.push({ players: 3, cards: round, width, stableSelectionAcrossSort: true });
    await context.close();
  }
  for (const [width, height] of [[1440, 900], [390, 844], [360, 800]].filter(wantedViewport)) {
    const { context, page } = await openFixture(6, 10, width, height);
    const layout = await bounds(page); expect(layout.overflow).toBe(false);
    for (const seat of layout.seats) {
      expect(seat.x).toBeGreaterThanOrEqual(-1);
      expect(seat.x + seat.width).toBeLessThanOrEqual(width + 1);
    }
    await screenshotStable(page,{ path: `${out}/six-seat-${width}.png` });
    checks.push({ players: 6, width, height, layout }); await context.close();
  }
  }
  if (process.env.LAYOUT_CASE !== 'hand') for (const [width, height] of [[1440, 900], [1280, 720], [390, 844], [360, 800], [844, 390]].filter(wantedViewport)) {
    const { context, page } = await openFixture(6, 10, width, height, true);
    const layout = await bounds(page); expect(layout.played).toHaveLength(6);
    await screenshotStable(page,{ path:`${out}/six-card-trick-${width}.png` });
    fs.writeFileSync(`${out}/six-card-trick-${width}.json`, JSON.stringify(layout,null,2));
    const overlap = (a,b) => !a||!b ? 0 : Math.max(0,Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x)) *
      Math.max(0,Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y));
    for (const card of layout.played) {
      for (const seat of layout.seats) expect(overlap(card,seat)).toBeLessThan(1);
      expect(overlap(card,layout.target)).toBeLessThan(1); expect(overlap(card,layout.action)).toBeLessThan(1);
    }
    for (const seat of layout.seats) { expect(overlap(seat,layout.action)).toBeLessThan(1); expect(overlap(seat,layout.target)).toBeLessThan(1); }
    for (let i=0;i<layout.seats.length;i++) for (let j=i+1;j<layout.seats.length;j++) expect(overlap(layout.seats[i],layout.seats[j])).toBeLessThan(1);
    expect(overlap(layout.target,layout.action)).toBeLessThan(1);
    expect(overlap(layout.chat,layout.confirm)).toBeLessThan(1);
    for (let i=0;i<layout.played.length;i++) for (let j=i+1;j<layout.played.length;j++) expect(overlap(layout.played[i],layout.played[j])).toBeLessThan(1);
    await screenshotStable(page,{ path:`${out}/six-card-trick-${width}.png` });
    await page.locator('#chat-toggle').click();
    await expect(page.locator('#room-chat')).toBeVisible();
    const chatBounds = await page.locator('#room-chat').boundingBox(), next = await page.locator('#next').boundingBox();
    await screenshotStable(page,{ path:`${out}/chat-dock-${width}.png` });
    expect(overlap(chatBounds,next)).toBeLessThan(1);
    await page.locator('#close-chat').click();
    await page.locator('#table-scores').click();
    await expect(page.locator('.score-ledger tbody tr')).toHaveCount(10);
    await screenshotStable(page,{ path:`${out}/score-ledger-${width}.png` });
    checks.push({ players:6,playedCards:6,width,height,layout,chatDock:true,ledger:true }); await context.close();
  }
  if (process.env.LAYOUT_CASE !== 'full-trick'&&wantedViewport([390,844])) {
    const { context, page } = await openFixture(3,20,390,844);
    await selectHandCard(page,page.locator('.hand .playable').first(),true);
    const selected=await page.locator('.hand .selected').getAttribute('data-card');
    await handControl(page, '#hand-collapse');
    await expect(page.locator('body')).toHaveClass(/hand-collapsed/);
    const collapsed=await page.locator('.hand-section').boundingBox();
    expect(collapsed.height).toBeLessThanOrEqual(60);
    await expect(page.locator('#confirm-play')).toBeEnabled();
    await screenshotStable(page,{path:`${out}/mobile-390-collapsed.png`});
    await handControl(page, '#hand-collapse');
    await expect(page.locator(`.hand [data-card="${selected}"]`)).toHaveClass(/selected/);
    await page.setViewportSize({width:844,height:390});
    await expect(page.locator('.hand.hand-strip')).toBeVisible();
    await expect(page.locator('.hand')).not.toHaveClass(/desktop-fan/);
    await expect(page.locator(`.hand [data-card="${selected}"]`)).toHaveClass(/selected/);
    const landscape=await bounds(page);expect(landscape.overflow).toBe(false);
    expect(landscape.scrollWidth).toBeGreaterThan(landscape.clientWidth);
    expect(landscape.confirm.y+landscape.confirm.height).toBeLessThanOrEqual(391);
    await screenshotStable(page,{path:`${out}/mobile-landscape-fan.png`});
    checks.push({width:390,rotatedWidth:844,collapsedHeight:collapsed.height,selectionPreserved:selected});
    await context.close();
  }
  expect(errors).toEqual([]);
  fs.writeFileSync(`${out}/layout-results.json`, JSON.stringify({ checks, errors }, null, 2));
  console.log(JSON.stringify({ layouts: checks.length, nativeTouch: true, selectionAndConfirm: true, errors }));
} finally { await browser.close(); }
