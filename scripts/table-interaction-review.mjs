import { chromium, expect } from '@playwright/test';
import fs from 'node:fs';
import { createGame, addPlayer, act, viewFor } from '../src/game.js';
import { createRandomStream } from '../src/random.js';
import { DEFAULT_OPTIONS } from '../src/rules-options.js';
import { CARD_COLLECT_MS } from '../src/table-motion.js';

// Local/manual only. The browser uses actual game fixtures and production
// renderers; response interception exposes their clocks without a debug API.
const base = process.env.GAME_URL || 'http://127.0.0.1:5173/';
const out = 'output/playwright'; fs.mkdirSync(out, { recursive:true });
const stamp = process.env.REVIEW_STAMP || '20261030';
const wanted = name => !process.env.REVIEW_CASE || process.env.REVIEW_CASE === name;
const checks = [], errors = [];
const browser = await chromium.launch({ channel:process.env.BROWSER_CHANNEL || 'chrome', headless:true });

function fixture(round, phase, short = false, players = 3) {
  const game = createGame(); game.randomState = createRandomStream(Array(11).fill(5));
  for (let i = 0; i < players; i++) addPlayer(game, `p${i}`, ['青岚','云舒','风行','竹影','星河','雨晴'][i]);
  act(game, 'p0', {type:'start',options:{...DEFAULT_OPTIONS,short}});
  for (let step = 0; step < 20000; step++) {
    if (game.phase === phase && (phase === 'finished' || game.round === round) && (phase !== 'play' || game.turn === 0)) {
      return {version:1,role:'practice',room:'离线练习',me:'p0',game,identities:{}};
    }
    const id = game.players[game.turn].id, view = viewFor(game,id);
    if (game.phase === 'trump') act(game,id,{type:'trump',suit:'blue'});
    else if (game.phase === 'bid') act(game,id,{type:'bid',value:view.bids[0]});
    else if (game.phase === 'play') act(game,id,{type:'play',card:view.legal[0]});
    else if (['trickEnd','roundEnd'].includes(game.phase)) act(game,'p0',{type:'next'});
    else throw Error(`Unexpected fixture phase: ${game.phase}`);
  }
  throw Error(`Fixture did not reach ${round}:${phase}`);
}

async function open(record, width, height, webgl = true, beforeNavigate = null, controlledCollection = false) {
  const context = await browser.newContext({viewport:{width,height},hasTouch:width<851,reducedMotion:'no-preference'});
  await context.addInitScript(({record,webgl,controlledCollection})=>{
    const alreadySeeded=controlledCollection&&sessionStorage.getItem('wizard-interaction-seeded')==='true';
    if(controlledCollection) {
      const now=Date.now(), event=record.game.events.findLast(event=>event.type==='trickEnd'&&
        event.round===record.game.round&&event.completedTricks===record.game.completedTricks);
      if(!event)throw Error('Collection review requires an actual completed trick event');
      if(!alreadySeeded)event.time=now;
      window.__collectionServerTime=now;
      Date.now=()=>window.__collectionServerTime;
    }
    record.game.turnDeadline = Date.now()+30000;
    if(!alreadySeeded)sessionStorage.setItem('wizard-room-session',JSON.stringify(record));
    if(controlledCollection)sessionStorage.setItem('wizard-interaction-seeded','true');
    localStorage.setItem('wizard-low-graphics','true');
    localStorage.setItem('wizard-trump-motion','false');
    localStorage.setItem('wizard-turn-sound','false');
    if (!webgl) {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function(kind,...args) { return kind.startsWith('webgl') ? null : original.call(this,kind,...args); };
    }
  },{record,webgl,controlledCollection});
  const page = await context.newPage(); page.on('pageerror',error=>errors.push(error.message));
  for (const [file,exposure] of [['card-face','window.__reviewFaceModule={cardFaceCanvas,paintCardFace};'],['card-art','window.__reviewArtModule={cardImage,loadedCardImage};']]) {
    await page.route(new RegExp(`/src/${file}\\.js(?:\\?|$)`),async route=>{
      const response = await route.fetch(); await route.fulfill({response,body:await response.text()+`\n${exposure}`});
    });
  }
  await page.route(/\/src\/main\.js(?:\?|$)/,async route=>{
    const response = await route.fetch();
    await route.fulfill({response,body:await response.text()+`
      window.__interactionReview = {
        get state() { return state; },
        get scene() { return tableScene; },
        get motion() { return tableMotion; },
        cardRect: playedCardRect,
        schedule() {
          let time = performance.now();
          tableMotion.now = () => time; tableMotion.last = time;
          this.advance = ms => { time += ms; window.__collectionServerTime += ms; };
          broadcast();
          updateEventEffects(true); render();
        }
      };`});
  });
  if (beforeNavigate) await beforeNavigate(page);
  await page.goto(base,{waitUntil:'domcontentloaded'});
  await page.locator('.table').waitFor();
  await page.waitForFunction(()=>!!window.__interactionReview);
  if (webgl) await page.waitForFunction(()=>document.body.classList.contains('has-webgl'));
  else await page.waitForFunction(()=>!document.body.classList.contains('has-webgl') && document.querySelector('#graphics')?.disabled);
  return {context,page};
}

async function selected(page) { return page.locator('.hand .selected').getAttribute('data-card'); }
async function selectLegal(page) {
  const card = page.locator('.hand .playable').first();
  if (page.viewportSize().width<851) await card.tap({position:{x:12,y:45}});
  else await card.click({position:{x:12,y:45}});
  await expect(page.locator('.hand .selected')).toHaveCount(1);
  return selected(page);
}

async function blankPoint(page) {
  return page.locator('.table').evaluate(table=>{
    const rect = table.getBoundingClientRect();
    for (let y = rect.top+100; y < rect.bottom-110; y+=24) for (let x = rect.left+12; x < rect.right-12; x+=24) {
      const node = document.elementFromPoint(x,y);
      if (node && table.contains(node) && node.matches('.table,.table-ring,.scene-host,canvas,.played-cards')) return {x,y};
    }
    throw Error('No actual blank table point found');
  });
}

async function inspectCards(page) {
  return page.evaluate(()=>{
    const review = window.__interactionReview;
    const winnerId = review.state.players[review.state.lastWinner]?.id;
    const ownId = document.querySelector('.own-status')?.dataset.player;
    const avatar = winnerId === ownId ? document.querySelector('.own-status .avatar')
      : document.querySelector('.opponents [data-player="'+winnerId+'"] .avatar');
    const winnerRect = avatar?.getBoundingClientRect();
    const winnerCenter = winnerRect ? [winnerRect.left+winnerRect.width/2,winnerRect.top+winnerRect.height/2] : null;
    return [...document.querySelectorAll('.played[data-card-id]')].map(node=>{
      const label = node.querySelector(':scope > small'), style = getComputedStyle(label);
      const transform = new DOMMatrix(getComputedStyle(node.querySelector('.card')).transform);
      const group = review.scene?.cards.get(node.dataset.cardId);
      const base = review.cardRect(node), face = node.querySelector('.card').getBoundingClientRect();
      const endpoint = [base.x+parseFloat(node.style.getPropertyValue('--winner-dx')),
        base.y+parseFloat(node.style.getPropertyValue('--winner-dy'))];
      const screen = group?.position.clone().project(review.scene.camera), canvas = review.scene?.renderer.domElement.getBoundingClientRect();
      const drawnCenter = group ? [canvas.left+(screen.x+1)*canvas.width/2,canvas.top+(1-screen.y)*canvas.height/2]
        : [face.left+face.width/2,face.top+face.height/2];
      return {id:node.dataset.cardId,pose:review.motion.pose(node.dataset.cardId),
        winnerId,winnerCenter,baseCenter:[base.x,base.y],drawnCenter,
        endpointError:winnerCenter && Math.hypot(endpoint[0]-winnerCenter[0],endpoint[1]-winnerCenter[1]),
        winnerDistance:winnerCenter && Math.hypot(drawnCenter[0]-winnerCenter[0],drawnCenter[1]-winnerCenter[1]),
        labelOpacity:Number(style.opacity),labelVisibility:style.visibility,
        cardOpacity:Number(getComputedStyle(node.querySelector('.card')).opacity),
        cardTranslation:[transform.m41,transform.m42],
        mesh:group ? {visible:group.visible,opacity:group.userData.face.material.opacity,
          distance:group.position.distanceTo(group.userData.target),collectDistance:group.userData.collectTo?.distanceTo(group.userData.target),
          offset:[node.style.getPropertyValue('--winner-dx'),node.style.getPropertyValue('--winner-dy')],
          layout:node.parentElement.dataset.layout} : null};
    });
  });
}
async function advance(page,ms) {
  const frame = await page.evaluate(ms=>{
    window.__interactionReview.advance(ms);
    return window.__interactionReview.scene?.frame;
  },ms);
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  // The low-power WebGL renderer intentionally skips 33/50ms frames. Observe
  // its next actual draw instead of assuming two 60Hz browser frames suffice.
  if (Number.isFinite(frame)) await page.waitForFunction(frame=>window.__interactionReview.scene.frame>frame,frame);
}

try {
  if(wanted('selection')) for (const [width,height] of [[1440,900],[390,844],[844,390]]) {
    const {context,page} = await open(fixture(19,'play'),width,height);
    const id = await selectLegal(page);
    await page.locator('#table-menu').click();
    await page.locator('.trump-display button.table-trump').click();
    const preview = page.locator('dialog.trump-preview');
    await expect(preview).toHaveAttribute('open','');
    await preview.locator('.trump-preview-face').click();
    await preview.locator('p').click();
    await expect(preview).toHaveAttribute('open','');
    await expect(page.locator('.hand .selected')).toHaveAttribute('data-card',id);
    await preview.locator('button').click();
    await expect(preview).toHaveCount(0);
    await expect(page.locator('.hand .selected')).toHaveAttribute('data-card',id);
    await page.locator('#hand-sort').click();
    await expect(page.locator('.hand .selected')).toHaveAttribute('data-card',id);
    await page.locator('#table-menu').click();
    await page.evaluate(()=>document.activeElement?.blur());
    // A drag which ends on an otherwise blank surface must not be a deselect tap.
    const point = await blankPoint(page);
    await page.mouse.move(point.x,point.y); await page.mouse.down();
    await page.mouse.move(point.x+42,point.y+8,{steps:6}); await page.mouse.up();
    await expect(page.locator('.hand .selected')).toHaveAttribute('data-card',id);
    // Exercise the hand's own swipe suppression with a genuine pointer sequence.
    const hand = await page.locator('.hand').boundingBox();
    await page.mouse.move(hand.x+hand.width*.65,hand.y+Math.min(50,hand.height/2));
    await page.mouse.down(); await page.mouse.move(hand.x+hand.width*.35,hand.y+Math.min(50,hand.height/2),{steps:8}); await page.mouse.up();
    await expect(page.locator('.hand .selected')).toHaveAttribute('data-card',id);
    const blank = await blankPoint(page);
    if (width<851) await page.touchscreen.tap(blank.x,blank.y);
    else await page.mouse.click(blank.x,blank.y);
    await expect(page.locator('.hand .selected')).toHaveCount(0);
    await expect(page.locator('#confirm-play')).toBeDisabled();
    const next = await selectLegal(page), before = await page.locator('.hand [data-card]').count();
    await page.locator('#confirm-play').click();
    await expect(page.locator(`.hand [data-card="${next}"]`)).toHaveCount(0);
    await expect(page.locator('.hand [data-card]')).toHaveCount(before-1);
    checks.push({selection:{width,height,touchTap:width<851,sortPreserved:true,trumpPreviewPreserved:true,blankDragPreserved:true,handSwipePreserved:true,blankTapCancelled:true,confirmationPlayed:next}});
    await context.close();
  }

  const finished = fixture(0,'finished',true);
  if(wanted('finished')) for (const [width,height,record] of [[1440,900,finished],[390,844,finished],[844,390,finished],[390,844,fixture(0,'finished',true,6)]]) {
    const {context,page} = await open(record,width,height);
    const panel = page.locator('.settlement-panel[aria-label="整局结果"]');
    await expect(panel).toBeVisible(); await expect(page.locator('#rematch')).toBeVisible();
    await expect(page.locator('.settlement-details')).not.toHaveAttribute('open','');
    const latest = record.game.history.at(-1);
    await expect(page.locator('.final-results')).toBeVisible();
    await expect(page.locator('.final-score-row')).toHaveCount(record.game.players.length);
    for (const player of record.game.players) {
      const row = page.locator(`.final-score-row[data-player="${player.id}"]`), result = latest.result.find(result=>result.id===player.id);
      await expect(row.locator('.final-player')).toContainText(player.name);
      await expect(row.locator('.final-bid-won')).toContainText(`${result.bid} / ${result.won}`);
      await expect(row.locator('.final-delta')).toHaveText(`${result.delta>=0?'+':''}${result.delta}`);
      await expect(row.locator('.final-total')).toHaveText(String(player.score));
      expect(await row.evaluate(node=>!!node.closest('details'))).toBe(false);
      await row.scrollIntoViewIfNeeded(); await expect(row).toBeInViewport();
    }
    await page.locator('#rematch').scrollIntoViewIfNeeded(); await expect(page.locator('#rematch')).toBeInViewport();
    await page.screenshot({path:`${out}/final-score-${width}x${height}-${record.game.players.length}players-${stamp}.png`});
    const geometry = await panel.evaluate(node=>{ const r=node.getBoundingClientRect(); return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,overflow:document.documentElement.scrollWidth>innerWidth}; });
    expect(geometry.left).toBeGreaterThanOrEqual(0); expect(geometry.right).toBeLessThanOrEqual(width+1);
    expect(geometry.top).toBeGreaterThanOrEqual(0); expect(geometry.bottom).toBeLessThanOrEqual(height+1); expect(geometry.overflow).toBe(false);
    checks.push({finished:{width,height,players:record.game.players.length,round:record.game.round,geometry}}); await context.close();
  }

  if(wanted('collection')) for (const webgl of [false,true]) for(const phase of ['trickEnd','roundEnd','finished']) {
    const record = fixture(phase==='finished'?0:2,phase,phase==='finished');
    const {context,page} = await open(record,webgl?1440:390,webgl?900:844,webgl,null,true);
    await page.evaluate(()=>window.__interactionReview.schedule());
    const before = await inspectCards(page); expect(before).toHaveLength(3);
    expect(before.every(card=>card.pose.collect===0 && card.labelOpacity===1)).toBe(true);
    // Sample the actual shared presentation clock around the label/movement edge.
    let elapsed = 0, hidden = null;
    while (elapsed < 3000-CARD_COLLECT_MS) {
      await advance(page,20); elapsed+=20;
      const cards = await inspectCards(page);
      if (cards.every(card=>card.labelOpacity===0 || card.labelVisibility==='hidden')) { hidden={elapsed,cards}; break; }
    }
    expect(hidden).not.toBeNull();
    expect(hidden.cards.every(card=>card.pose.collect===0 && (webgl?card.mesh.visible && card.mesh.opacity===1:card.cardOpacity===1))).toBe(true);
    await page.screenshot({path:`${out}/collection-labels-first-${phase}-${webgl?'3d':'2d'}-${stamp}.png`});
    await advance(page,2450-elapsed);
    const moving = await inspectCards(page);
    expect(moving.every(card=>card.pose.collect>0 && card.pose.collect<1 && card.labelOpacity===0)).toBe(true);
    if (webgl) expect(moving.every(card=>card.mesh.distance>0 && card.mesh.visible),JSON.stringify(moving)).toBe(true);
    else expect(moving.every((card,index)=>card.cardOpacity>0 && Math.hypot(card.cardTranslation[0]-before[index].cardTranslation[0],card.cardTranslation[1]-before[index].cardTranslation[1])>1)).toBe(true);
    expect(moving.every(card=>card.endpointError<2),JSON.stringify(moving)).toBe(true);
    await page.screenshot({path:`${out}/collection-moving-${phase}-${webgl?'3d':'2d'}-${stamp}.png`});
    // Pause and chat use the real practice controls; both redraw paths must
    // retain the same collection progress on the shared presentation clock.
    await page.locator('#room-pause').click();
    const paused = await inspectCards(page);
    await advance(page,10000);
    await page.locator('#chat-toggle').click();
    await page.locator('#chat-input').fill('收牌暂停后聊天重绘');
    await page.locator('#chat-form button').click();
    await page.locator('#close-chat').click();
    await page.evaluate(()=>dispatchEvent(new Event('resize')));
    const redrawn = await inspectCards(page);
    expect(redrawn.map(card=>card.pose)).toEqual(paused.map(card=>card.pose));
    await page.reload({waitUntil:'domcontentloaded'});
    await page.locator('.table').waitFor();
    await page.waitForFunction(()=>!!window.__interactionReview);
    await expect(page.locator('body')).toHaveAttribute('data-paused','true');
    if(webgl)await page.waitForFunction(()=>document.body.classList.contains('has-webgl'));
    await page.evaluate(()=>window.__interactionReview.schedule());
    await advance(page,0);
    const recovered=await inspectCards(page);
    expect(recovered.map(card=>card.pose)).toEqual(paused.map(card=>card.pose));
    await page.screenshot({path:`${out}/collection-paused-reload-${phase}-${webgl?'3d':'2d'}-${stamp}.png`});
    await page.locator('#room-pause').click();
    await advance(page,550);
    const collected = await inspectCards(page);
    expect(collected.every(card=>card.pose.collect===1 && card.labelOpacity===0 && (webgl?!card.mesh.visible:card.cardOpacity===0)),JSON.stringify(collected)).toBe(true);
    expect(collected.every(card=>card.winnerDistance<2),JSON.stringify(collected)).toBe(true);
    expect(await page.locator('body').getAttribute('data-phase')).toBe(phase);
    expect((await page.evaluate(()=>window.__interactionReview.state.trick.length))).toBe(3);
    checks.push({collection:{webgl,phase,manual:true,before,labelHiddenAt:hidden.elapsed,moving,paused,redrawn,recovered,collected,chatAndPausePreserved:true,pausedReloadPreserved:true}}); await context.close();
  }
  if(wanted('preloading')) {
    const requests = new Map();
    const {context,page} = await open(fixture(1,'roundEnd'),1440,900,true,async page=>{
      page.on('request',request=>{
        if (request.resourceType() !== 'image' || !/\/assets\/cards\/.+\.svg(?:\?|$)/.test(request.url())) return;
        const path = new URL(request.url()).pathname; requests.set(path,(requests.get(path)||0)+1);
      });
    });
    await expect.poll(()=>page.evaluate(async()=>{
      const {deck} = await import('/src/game.js');
      const {cardImage,loadedCardImage} = window.__reviewArtModule;
      return new Map(deck().map(card=>[cardImage(card),loadedCardImage(card)])).size===54 && deck().every(card=>!!loadedCardImage(card));
    }),{timeout:20000}).toBe(true);
    const prepared = await page.evaluate(async()=>{
      const {deck} = await import('/src/game.js');
      const {cardImage,loadedCardImage} = window.__reviewArtModule;
      const {cardFaceCanvas,paintCardFace} = window.__reviewFaceModule;
      const scene = window.__interactionReview.scene;
      const card = deck().find(card=>!scene.textures.has(cardImage(card)));
      const before = scene.textures.size, texture = scene.face(card);
      const expected = document.createElement('canvas'); expected.width=320;expected.height=480;
      paintCardFace(expected.getContext('2d'),loadedCardImage(card),card);
      const actual = texture.image.getContext('2d').getImageData(0,0,320,480).data;
      const wanted = expected.getContext('2d').getImageData(0,0,320,480).data;
      return {card:card.id,newTexture:scene.textures.size===before+1,
        synchronousReady:texture.userData.faceReady,sharedCanvas:texture.image===cardFaceCanvas(card),
        artworkPixelsMatch:actual.every((value,index)=>value===wanted[index]),
        beforeTextures:before,afterTextures:scene.textures.size};
    });
    expect(prepared.newTexture).toBe(true); expect(prepared.synchronousReady).toBe(true);
    expect(prepared.sharedCanvas,JSON.stringify(prepared)).toBe(true); expect(prepared.artworkPixelsMatch).toBe(true);
    expect(requests.size).toBe(54); expect([...requests.values()].every(count=>count===1)).toBe(true);
    checks.push({preloading:{automaticAtRoundEnd:true,uniqueArtworkRequests:requests.size,...prepared}});
    await context.close();
  }
  expect(errors).toEqual([]);
  fs.writeFileSync(`${out}/table-interaction-review.json`,JSON.stringify({checks,errors},null,2));
  console.log(JSON.stringify({checks:checks.map(check=>check.collection ? {collection:{
    webgl:check.collection.webgl,phase:check.collection.phase,manual:true,
    labelHiddenAt:check.collection.labelHiddenAt,
    maxWinnerEndpointError:Math.max(...check.collection.collected.map(card=>card.winnerDistance)),
    chatAndPausePreserved:check.collection.chatAndPausePreserved,
    pausedReloadPreserved:check.collection.pausedReloadPreserved}} : check),errors}));
} finally { await browser.close(); }
