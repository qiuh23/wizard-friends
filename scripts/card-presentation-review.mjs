import { chromium, expect } from '@playwright/test';
import fs from 'node:fs';
import { createGame, addPlayer, act, viewFor } from '../src/game.js';
import { createRandomStream } from '../src/random.js';
import { DEFAULT_OPTIONS } from '../src/rules-options.js';

// Local/manual only: hold actual image requests and inspect the real renderer.
const base = process.env.GAME_URL || 'http://127.0.0.1:5173/';
const out = 'output/playwright'; fs.mkdirSync(out, { recursive:true });
const errors = [], checks = [];
const browser = await chromium.launch({ channel:process.env.BROWSER_CHANNEL || 'chrome', headless:true });
function fixture(round, phase = 'bid') {
  const game = createGame(); game.randomState = createRandomStream(Array(11).fill(5));
  for (let i = 0; i < 3; i++) addPlayer(game, `p${i}`, ['青岚','云舒','风行'][i]);
  act(game, 'p0', {type:'start',options:DEFAULT_OPTIONS});
  for (let step = 0; step < 20000; step++) {
    if (game.round === round && game.phase === phase && (phase === 'bid' ? viewFor(game,'p0').canBid : game.turn === 0)) {
      return {version:1,role:'practice',room:'离线练习',me:'p0',game,identities:{}};
    }
    const id = game.players[game.turn].id, view = viewFor(game,id);
    if (game.phase === 'trump') act(game,id,{type:'trump',suit:'blue'});
    else if (game.phase === 'bid') act(game,id,{type:'bid',value:view.bids[0]});
    else if (game.phase === 'play') act(game,id,{type:'play',card:view.legal[0]});
    else if (['trickEnd','roundEnd'].includes(game.phase)) act(game,'p0',{type:'next'});
    else throw Error(`Unexpected fixture phase: ${game.phase}`);
  }
  throw Error('Fixture did not reach its requested stage');
}
try {
  const context = await browser.newContext({viewport:{width:1200,height:800},reducedMotion:'reduce'});
  const page = await context.newPage(); page.on('pageerror',error=>errors.push(error.message));
  const requests = new Map(); let release;
  const held = new Promise(resolve=>{release=resolve;});
  await page.route(/\/src\/assets\/cards\/[^/]+\.svg/,async route=>{
    if (route.request().resourceType() !== 'image') return route.continue();
    const url = new URL(route.request().url()).pathname;
    requests.set(url,(requests.get(url)||0)+1);
    await held; await route.continue();
  });
  await page.route(/\/src\/table-scene\.js(?:\?|$)/,async route=>{
    const response = await route.fetch();
    await route.fulfill({response,body:(await response.text()).replace('this.animate(0);','window.__reviewScene=this;this.animate(0);')});
  });
  await page.goto(base,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__reviewScene?.textures.size === 3);
  const inspectTexture = () => page.evaluate(()=>{
    const scene = window.__reviewScene, texture = scene.trumpFace.material.map;
    scene.renderer.render(scene.scene,scene.camera);
    const gl = scene.renderer.getContext(), p = scene.trump.position.clone().project(scene.camera), pixel = new Uint8Array(4);
    gl.readPixels(Math.floor((p.x+1)*gl.drawingBufferWidth/2),Math.floor((p.y+1)*gl.drawingBufferHeight/2),1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);
    return {canvas:texture.image instanceof HTMLCanvasElement,
      paper:[...texture.image.getContext('2d').getImageData(40,300,1,1).data],pixel:[...pixel]};
  });
  const waiting = await inspectTexture();
  expect(waiting.canvas).toBe(true); expect(waiting.paper).toEqual([232,222,202,255]);
  expect(waiting.pixel.slice(0,3).reduce((sum,n)=>sum+n,0)).toBeGreaterThan(300);
  const htmlPaper = await page.locator('.hero-cards .card').evaluateAll(cards=>cards.map(card=>getComputedStyle(card).backgroundColor));
  expect(htmlPaper.every(color=>color === 'rgb(232, 222, 202)')).toBe(true);
  await page.screenshot({path:`${out}/card-loading-fallback-20261029.png`});
  release();
  await page.evaluate(async()=>{
    const {loadCardImage} = await import('/src/card-art.js');
    await loadCardImage({kind:'wizard'});
  });
  const loaded = await inspectTexture(); expect(loaded.paper).not.toEqual(waiting.paper);
  expect(requests.size).toBe(3); expect([...requests.values()]).toEqual([1,1,1]);
  await page.route('**/assets/cards/green-13.svg',route=>route.abort());
  const unavailable = await page.evaluate(async()=>{
    const scene = window.__reviewScene, card = {kind:'number',suit:'green',rank:13};
    const texture = scene.face(card);
    const {loadCardImage} = await import('/src/card-art.js');
    await loadCardImage(card).catch(()=>{});
    return [...texture.image.getContext('2d').getImageData(40,300,1,1).data];
  });
  expect(unavailable).toEqual([232,222,202,255]);
  checks.push({slowImages:waiting,loaded,requests:[...requests],unavailable});
  await context.close();

  for (const [width,height] of [[1440,900],[390,844],[844,390]]) for (const round of [1,20]) {
    const context = await browser.newContext({viewport:{width,height},hasTouch:width<851,reducedMotion:'reduce'});
    await context.addInitScript(record=>sessionStorage.setItem('wizard-room-session',JSON.stringify(record)),fixture(round));
    const page = await context.newPage(); page.on('pageerror',error=>errors.push(error.message));
    await page.goto(base); await page.locator('.bid-options').waitFor();
    const geometry = await page.locator('.bid-options').evaluate(row=>{
      const r=row.getBoundingClientRect(),a=row.firstElementChild.getBoundingClientRect(),b=row.lastElementChild.getBoundingClientRect();
      return {center:(r.left+r.right)/2,optionsCenter:(a.left+b.right)/2,overflow:row.scrollWidth>row.clientWidth,
        firstVisible:a.left>=r.left,lastVisible:b.right<=r.right+1};
    });
    if (!geometry.overflow) expect(Math.abs(geometry.center-geometry.optionsCenter)).toBeLessThan(1);
    else {
      expect(geometry.firstVisible).toBe(true);
      await page.locator('.bid-options').evaluate(row=>{row.scrollLeft=row.scrollWidth;});
      expect(await page.locator('.bid-options').evaluate(row=>row.lastElementChild.getBoundingClientRect().right<=row.getBoundingClientRect().right+1)).toBe(true);
    }
    if (round === 1) await page.screenshot({path:`${out}/prediction-centered-${width}-20261029.png`});
    checks.push({width,height,round,predictions:geometry}); await context.close();
  }

  const handContext = await browser.newContext({viewport:{width:1440,height:900},reducedMotion:'no-preference'});
  await handContext.addInitScript(record=>{
    record.game.turnDeadline=Date.now()+30000;
    sessionStorage.setItem('wizard-room-session',JSON.stringify(record));
    localStorage.setItem('wizard-low-graphics','true');
  },fixture(20,'play'));
  const handPage = await handContext.newPage(); handPage.on('pageerror',error=>errors.push(error.message));
  await handPage.goto(base); await handPage.locator('.hand.desktop-fan').waitFor();
  const card = handPage.locator('.hand .card').first();
  const widthBefore = await card.evaluate(node=>node.offsetWidth);
  await card.hover({position:{x:12,y:45}});
  await expect(handPage.locator('.hover-preview')).toBeHidden();
  await expect(handPage.locator('.hand .hovered')).toHaveCount(1);
  const legal = handPage.locator('.hand .playable').first();
  await legal.click({position:{x:12,y:45}});
  await handPage.mouse.move(20,100);
  await expect.poll(()=>handPage.locator('.hand .selected').evaluate(node=>Math.round(parseFloat(getComputedStyle(node).translate.split(' ')[1])))).toBe(-26);
  expect(await card.evaluate(node=>node.offsetWidth)).toBe(widthBefore);
  await expect(handPage.locator('.selected-preview')).toBeHidden();
  await expect(handPage.locator('#confirm-play')).toBeEnabled();
  expect((await handPage.locator('.hand .card').count())).toBe(20);
  await handPage.screenshot({path:`${out}/desktop-fan-open-selected-20261029.png`});
  checks.push('desktop fan opens without card scaling or floating previews; selected card stays raised; confirmation remains required');
  await handContext.close(); expect(errors).toEqual([]);
  fs.writeFileSync(`${out}/card-presentation-review.json`,JSON.stringify({checks,errors},null,2));
  console.log(JSON.stringify({checks,errors}));
} finally { await browser.close(); }
