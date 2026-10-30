import { chromium, expect } from '@playwright/test';
import fs from 'node:fs';
import { createGame, addPlayer, act, viewFor } from '../src/game.js';
import { createRandomStream } from '../src/random.js';
import { DEFAULT_OPTIONS } from '../src/rules-options.js';

// Manual review only: exercise production renderers with legal engine records.
// Fetch interception keeps inspection and role switching out of the product API.
const base = process.env.GAME_URL || 'http://127.0.0.1:5186/';
const out = 'output/playwright'; fs.mkdirSync(out,{recursive:true});
const stamp = process.env.REVIEW_STAMP || '20261030-hand-actions';
const wanted=([width,height])=>!process.env.REVIEW_VIEWPORT||process.env.REVIEW_VIEWPORT===`${width}x${height}`;
const checks = [], errors = [];
const browser = await chromium.launch({channel:process.env.BROWSER_CHANNEL || 'chrome',headless:true});
const overlap = (a,b) => a.left < b.right-1 && a.right > b.left+1 && a.top < b.bottom-1 && a.bottom > b.top+1;

function fixture(round,phase,{count=3,ownTurn=true,short=false}={}) {
  const game = createGame(); game.randomState = createRandomStream(Array(11).fill(5));
  for(let i=0;i<count;i++) addPlayer(game,`p${i}`,['青岚','云舒','风行','竹影','星河','雨晴'][i]);
  act(game,'p0',{type:'start',options:{...DEFAULT_OPTIONS,short}});
  for(let step=0;step<20000;step++) {
    if(game.phase===phase && (phase==='finished'||game.round===round)
      && (phase!=='play'||(game.turn===0)===ownTurn)) {
      return {version:1,role:'practice',room:'离线练习',me:'p0',game,identities:{}};
    }
    const id=game.players[game.turn].id,view=viewFor(game,id);
    if(game.phase==='trump') act(game,id,{type:'trump',suit:'blue'});
    else if(game.phase==='bid') act(game,id,{type:'bid',value:view.bids[0]});
    else if(game.phase==='play') act(game,id,{type:'play',card:view.legal[0]});
    else if(['trickEnd','roundEnd'].includes(game.phase)) act(game,'p0',{type:'next'});
    else throw Error(`Unexpected fixture phase ${game.phase}`);
  }
  throw Error(`Fixture not reached: ${round}:${phase}`);
}

async function open(record,width,height) {
  const context=await browser.newContext({viewport:{width,height},hasTouch:width<851,reducedMotion:'reduce'});
  await context.addInitScript(record=>{
    record.game.turnDeadline=Date.now()+600000;
    sessionStorage.setItem('wizard-room-session',JSON.stringify(record));
    localStorage.setItem('wizard-low-graphics','true');
    localStorage.setItem('wizard-trump-motion','false');
    localStorage.setItem('wizard-turn-sound','false');
  },record);
  const page=await context.newPage(); page.on('pageerror',e=>errors.push(e.message));
  await page.route(/\/src\/main\.js(?:\?|$)/,async route=>{
    const response=await route.fetch();
    await route.fulfill({response,body:await response.text()+`
      window.__handActionsReview={
        get state(){return state;}, get game(){return game;}, get scene(){return tableScene;},
        clearNotice(){notify('');},
        async apply(next,role='host') {
          clearTimeout(turnTimer);clearTimeout(botTimer);game=next;me='p0';
          game.turnDeadline=Date.now()+600000;practice=true;isHost=role==='host';
          spectating=role==='spectator';networkReady=true;
          const {spectatorView}=await import('/src/game.js');
          state=spectating?spectatorView(game):viewFor(game,me);
          state.lifecycle=next.lifecycle||{};updateEventEffects(true);render();
        }
      };`});
  });
  await page.goto(base,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!!window.__handActionsReview);
  await page.locator('.table').waitFor();
  await page.waitForFunction(()=>document.body.classList.contains('has-webgl'));
  await page.evaluate(()=>window.__handActionsReview.clearNotice());
  return {context,page};
}

async function buttonGeometry(page,selector) {
  const geometry=await page.locator(selector).evaluate(button=>{
    const r=button.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;
    return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height,
      viewportWidth:innerWidth,viewportHeight:innerHeight,scrollY,
      unblocked:button.contains(document.elementFromPoint(x,y))};
  });
  expect(geometry.scrollY).toBe(0);expect(geometry.left).toBeGreaterThanOrEqual(0);
  expect(geometry.top).toBeGreaterThanOrEqual(0);expect(geometry.right).toBeLessThanOrEqual(geometry.viewportWidth);
  expect(geometry.bottom).toBeLessThanOrEqual(geometry.viewportHeight);expect(geometry.unblocked).toBe(true);
  expect(geometry.height).toBeGreaterThanOrEqual(44);
  return geometry;
}

async function geometry(page) {
  const button=await buttonGeometry(page,'#confirm-play');
  const data=await page.evaluate(()=>{
    const rect=node=>{const r=node.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom}};
    const shown=node=>{const s=getComputedStyle(node),r=node.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0};
    const review=window.__handActionsReview,scene=review.scene,canvas=scene.renderer.domElement.getBoundingClientRect();
    const publicFaces=[];
    for(const group of scene.cards.values()) {
      if(!group.visible) continue;
      const face=group.userData.face,{width,height}=face.geometry.parameters,points=[];
      group.updateMatrixWorld(true);
      for(const x of [-width/2,width/2]) for(const y of [-height/2,height/2]) {
        const p=face.position.clone().set(x,y,0).applyMatrix4(face.matrixWorld).project(scene.camera);
        points.push({x:canvas.left+(p.x+1)*canvas.width/2,y:canvas.top+(1-p.y)*canvas.height/2});
      }
      publicFaces.push({left:Math.min(...points.map(p=>p.x)),right:Math.max(...points.map(p=>p.x)),top:Math.min(...points.map(p=>p.y)),bottom:Math.max(...points.map(p=>p.y))});
    }
    return {cards:[...document.querySelectorAll('.hand [data-card]')].filter(shown).map(rect),
      obstacles:[...document.querySelectorAll('.opponents .player,.own-status > .avatar,.own-status > .own-metrics,.own-action > span,.played > small')].filter(shown).map(rect).concat(publicFaces),
      phase:review.state.phase,mode:document.body.dataset.tableLayout,expanded:document.querySelector('.hand-section').classList.contains('expanded')};
  });
  expect(data.cards.length).toBeGreaterThan(0);
  const top=Math.min(...data.cards.map(r=>r.top)),left=Math.min(...data.cards.map(r=>r.left)),right=Math.max(...data.cards.map(r=>r.right));
  fs.writeFileSync(`${out}/hand-actions-last-geometry-${stamp}.json`,JSON.stringify({button,...data,handTop:top,gap:top-button.bottom},null,2));
  expect(button.bottom,`${button.viewportWidth}x${button.viewportHeight}: button stays above lifted cards`).toBeLessThanOrEqual(top+1);
  expect(top-button.bottom,`${button.viewportWidth}: button stays close to hand`).toBeLessThanOrEqual(64);
  expect((button.left+button.right)/2).toBeGreaterThanOrEqual(left);
  expect((button.left+button.right)/2).toBeLessThanOrEqual(right);
  for(const obstacle of [...data.cards,...data.obstacles]) expect(overlap(button,obstacle),`${button.viewportWidth}x${button.viewportHeight}: button overlaps ${JSON.stringify(obstacle)}`).toBe(false);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
  return {button,handTop:top,gap:top-button.bottom,mode:data.mode};
}

async function selectLegal(page) {
  const point=await page.locator('.hand .playable').evaluateAll(nodes=>{
    for(const node of nodes) {
      const r=node.getBoundingClientRect();
      for(const fx of [.15,.5,.85]) for(const fy of [.45,.65,.85]) {
        const x=r.left+r.width*fx,y=r.top+r.height*fy;
        if(x>0&&x<innerWidth&&y>0&&y<innerHeight&&node.contains(document.elementFromPoint(x,y))) return {x,y,id:node.dataset.card};
      }
    }
    throw Error('No unobscured legal hand card');
  });
  if(page.viewportSize().width<851) await page.touchscreen.tap(point.x,point.y);
  else await page.mouse.click(point.x,point.y);
  await expect(page.locator('.hand .selected')).toHaveAttribute('data-card',point.id);
  return point.id;
}

async function blank(page) {
  const point=await page.locator('.table').evaluate(table=>{
    const r=table.getBoundingClientRect();
    for(let y=r.top+80;y<r.bottom-100;y+=20) for(let x=r.left+12;x<r.right-12;x+=20) {
      const node=document.elementFromPoint(x,y);
      if(node&&table.contains(node)&&node.matches('.table,.table-ring,.scene-host,canvas,.played-cards')) return {x,y};
    }
    throw Error('No blank surface point');
  });
  if(page.viewportSize().width<851) await page.touchscreen.tap(point.x,point.y);
  else await page.mouse.click(point.x,point.y);
}

async function handSetting(page,selector) {
  await page.locator('#table-menu').click();
  await page.locator(selector).click();
  await page.locator('#table-menu').click();
}

try {
  const playing=fixture(8,'play'),notOwn=fixture(8,'play',{ownTurn:false}),bid=fixture(8,'bid'),roundEnd=fixture(8,'roundEnd');
  for(const [width,height] of [[1440,900],[390,844],[844,390],[360,640],[844,300]].filter(wanted)) {
    const {context,page}=await open(playing,width,height);
    await expect(page.locator('.hand-section .play-confirm #confirm-play')).toHaveCount(1);
    await expect(page.locator('#confirm-play')).toHaveText('出牌');
    await expect(page.locator('#confirm-play')).toBeDisabled();
    await expect(page.locator('.play-confirm button')).toHaveCount(1);
    await expect(page.locator('#cancel-card')).toHaveCount(0);
    const initial=await geometry(page),id=await selectLegal(page);
    await expect(page.locator('#confirm-play')).toBeEnabled();
    // Finish the real fan transition before checking the selected card's extent.
    await page.waitForTimeout(300);
    const selected=await geometry(page);
    await handSetting(page,'#hand-sort');
    await expect(page.locator('.hand .selected')).toHaveAttribute('data-card',id);
    await page.waitForTimeout(300);
    const sorted=await geometry(page);
    await handSetting(page,'#hand-expand');await page.waitForTimeout(300);
    await expect(page.locator('.hand-grid')).toBeVisible();
    const expanded=await geometry(page);
    await handSetting(page,'#hand-expand');await page.waitForTimeout(300);
    await blank(page);await expect(page.locator('.hand .selected')).toHaveCount(0);
    await expect(page.locator('#confirm-play')).toBeDisabled();
    const played=await selectLegal(page);
    await page.waitForTimeout(300);
    if(width===1440||width===390) await page.screenshot({path:`${out}/hand-action-selected-${width}x${height}-${stamp}.png`});
    const before=await page.evaluate(()=>window.__handActionsReview.game.events.filter(e=>e.type==='play'&&e.card?.id===document.querySelector('.hand .selected').dataset.card).length);
    await page.locator('#confirm-play').click();
    await expect(page.locator(`.hand [data-card="${played}"]`)).toHaveCount(0);
    expect(await page.evaluate(id=>window.__handActionsReview.game.events.filter(e=>e.type==='play'&&e.card?.id===id).length,played)).toBe(before+1);
    await expect(page.locator('.hand .selected')).toHaveCount(0);
    await expect(page.locator('#confirm-play')).toHaveCount(0);
    for(const record of [notOwn,bid,roundEnd]) {
      await page.evaluate(record=>window.__handActionsReview.apply(record.game),record);
      await expect(page.locator('#confirm-play')).toHaveCount(0);
    }
    checks.push({playing:{width,height,initial,selected,sorted,expanded,played,singleSubmission:true,hiddenOutsideOwnTurn:true}});
    await context.close();
  }

  const final=fixture(0,'finished',{short:true,count:6});
  for(const [width,height] of [[1440,900],[390,844],[360,640],[844,300]].filter(wanted)) {
    const {context,page}=await open(final,width,height);
    await expect(page.locator('.settlement-actions #finished-dissolve')).toHaveText('解散房间');
    await expect(page.locator('#room-dissolve')).toHaveCount(1);
    await expect(page.locator('#confirm-play')).toHaveCount(0);
    const rematch=await buttonGeometry(page,'#rematch'),dissolve=await buttonGeometry(page,'#finished-dissolve');
    expect(overlap(rematch,dissolve)).toBe(false);
    if(width===1440||width===390) await page.screenshot({path:`${out}/finished-dissolve-${width}x${height}-${stamp}.png`});
    for(const role of ['guest','spectator']) {
      await page.evaluate(({record,role})=>window.__handActionsReview.apply(record.game,role),{record:final,role});
      await expect(page.locator('#finished-dissolve,#room-dissolve,#rematch')).toHaveCount(0);
    }
    await page.evaluate(record=>window.__handActionsReview.apply(record.game),final);
    const dialogs=[];page.on('dialog',async dialog=>{dialogs.push(dialog.message());await dialog.accept();});
    await page.locator('#finished-dissolve').click();
    await expect(page.locator('.table')).toHaveCount(0);
    expect(dialogs).toHaveLength(1);expect(dialogs[0]).toContain('确定解散房间');
    expect(await page.evaluate(()=>sessionStorage.getItem('wizard-room-session'))).toBeNull();
    checks.push({finished:{width,height,players:6,rematch,dissolve,rolePermissions:true,actualDissolution:true}});
    await context.close();
  }
  expect(errors).toEqual([]);
  console.log(JSON.stringify({checks,errors},null,2));
} catch(error) {
  for(const context of browser.contexts()) for(const page of context.pages()) {
    if(!page.isClosed()) await page.screenshot({path:`${out}/hand-actions-failure-${stamp}.png`}).catch(()=>{});
  }
  throw error;
} finally {
  fs.writeFileSync(`${out}/hand-actions-review-${stamp}.json`,JSON.stringify({checks,errors},null,2));
  await browser.close();
}
