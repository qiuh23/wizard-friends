import { chromium, expect } from '@playwright/test';
import fs from 'node:fs';
import { createGame, addPlayer, act, viewFor } from '../src/game.js';
import { createRandomStream } from '../src/random.js';
import { DEFAULT_OPTIONS } from '../src/rules-options.js';
import { leadInfo } from '../src/table-summary.js';

// Local/manual layout coverage; use legal engine actions and browser-only
// renderer inspection rather than adding state injection to the application.
const base = process.env.GAME_URL || 'http://127.0.0.1:5173/';
const out = 'output/playwright'; fs.mkdirSync(out,{recursive:true});
const errors = [], checks = [];
function fixture(count, round, phase, mode = 'public', selfLeader = false) {
  const game = createGame(); game.randomState = createRandomStream(Array(11).fill(8));
  for (let i=0;i<count;i++) addPlayer(game,`p${i}`,['远帆探险的旅人','云舒','风行','清月','星河','林语'][i]);
  act(game,'p0',{type:'start',options:{...DEFAULT_OPTIONS,predictionMode:mode}});
  for (let step=0;step<15000;step++) {
    if (game.round>=round && game.phase===phase && (phase!=='bid'||viewFor(game,'p0').canBid)
      && (!selfLeader || game.players[leadInfo(game).seat].id === 'p0')) {
      game.turnDeadline=Date.now()+600000;
      return {version:1,role:'practice',room:'离线练习',me:'p0',game,identities:{}};
    }
    const id=(game.phase==='bid' ? game.players.find(p=>viewFor(game,p.id).canBid) : game.players[game.turn]).id, view=viewFor(game,id);
    if (game.phase==='trump') act(game,id,{type:'trump',suit:'yellow'});
    else if (game.phase==='bid') act(game,id,{type:'bid',value:view.bids[0]});
    else if (game.phase==='play') act(game,id,{type:'play',card:view.legal[0]});
    else if (['trickEnd','roundEnd'].includes(game.phase)) act(game,'p0',{type:'next'});
    else throw Error(`Unreachable fixture: ${game.phase}`);
  }
  throw Error('Fixture did not reach requested phase');
}
const overlaps=(a,b)=>a.left<b.right-1 && a.right>b.left+1 && a.top<b.bottom-1 && a.bottom>b.top+1;
const browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL||'chrome',headless:true});
async function open(record,width,height,webgl=true) {
  const context=await browser.newContext({viewport:{width,height},hasTouch:width<851,reducedMotion:'reduce'});
  await context.addInitScript(({record,webgl})=>{
    sessionStorage.setItem('wizard-room-session',JSON.stringify(record));
    localStorage.setItem('wizard-trump-motion','false');
    localStorage.setItem('wizard-low-graphics','true');
    if(!webgl) {
      const get=HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext=function(kind,...args){return kind.startsWith('webgl')?null:get.call(this,kind,...args)};
    }
  },{record,webgl});
  const page=await context.newPage(); page.on('pageerror',e=>errors.push(e.message));
  await page.route(/\/src\/table-scene\.js(?:\?|$)/,async route=>{
    const response=await route.fetch();
    await route.fulfill({response,body:(await response.text()).replace('this.animate(0);','window.__clarityScene=this;this.animate(0);')});
  });
  await page.goto(base);await page.locator('.own-status').waitFor();
  if(webgl) await page.waitForFunction(()=>window.__clarityScene?.mode==='game');
  await page.waitForTimeout(160);
  return {page,context};
}
async function inspect(page,webgl) {
  return page.evaluate(webgl=>{
    const rect=el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}};
    const shown=el=>getComputedStyle(el).display!=='none'&&getComputedStyle(el).visibility!=='hidden';
    const avatars=[...document.querySelectorAll('.player .avatar')];
    const slot=document.querySelector('.trump-card');
    const projected=[];
    const scene=window.__clarityScene;
    if(webgl && scene.trump.visible) {
      scene.paused=true;
      const canvas=scene.renderer.domElement.getBoundingClientRect();
      const original=scene.trumpCard.rotation.y;
      for(const angle of [0,Math.PI/4,Math.PI/2,Math.PI]) {
        scene.trumpCard.rotation.y=angle;scene.trump.position.y=scene.trump.userData.baseHeight;
        scene.trump.updateMatrixWorld(true);
        const points=[];
        for(const x of [-.56,.56])for(const y of [-.84,.84])for(const z of [-.03,.03]) {
          const p=scene.camera.position.clone().set(x,y,z).applyMatrix4(scene.trumpCard.matrixWorld).project(scene.camera);
          points.push({x:canvas.left+(p.x+1)*canvas.width/2,y:canvas.top+(1-p.y)*canvas.height/2});
        }
        projected.push({left:Math.min(...points.map(p=>p.x)),right:Math.max(...points.map(p=>p.x)),top:Math.min(...points.map(p=>p.y)),bottom:Math.max(...points.map(p=>p.y))});
      }
      scene.trumpCard.rotation.y=original;scene.trump.updateMatrixWorld(true);
    }
    return {overflow:document.documentElement.scrollWidth>innerWidth,
      players:[...document.querySelectorAll('.player')].map(rect),
      avatars:avatars.map(el=>({rect:rect(el),label:el.getAttribute('aria-label')})),
      panels:[...document.querySelectorAll('.action-panel')].filter(shown).map(rect),
      slot:slot?rect(slot):null,occluded:document.querySelector('.trump-display')?.dataset.occluded,
      projected,flat:document.querySelector('.player')?getComputedStyle(document.querySelector('.player')).backgroundColor:null,
      trumpMarks:[...document.querySelectorAll('.trump-card .corner')].map(el=>getComputedStyle(el).visibility),
      overlay:getComputedStyle(document.querySelector('.scene-host'),'::after').display,
      pauseVisible:shown(document.querySelector('#room-pause')),
    };
  },webgl);
}
try {
  if (process.env.CLARITY_CASE !== 'secondary') {
  for(const [width,height] of [[1440,900],[1280,720],[390,844],[360,640],[844,390],[667,375]]) {
    for(const count of [3,4,5,6]) {
      const record=fixture(count,8,'bid');
      const {page,context}=await open(record,width,height);
      const data=await inspect(page,true);
      expect(data.overflow,`${width}/${count}: overflow`).toBe(false);
      expect(data.flat).toBe('rgba(0, 0, 0, 0)');expect(data.overlay).toBe('none');expect(data.pauseVisible).toBe(true);
      for(const player of data.players) for(const panel of data.panels) expect(overlaps(player,panel),`${width}/${count}: bid overlaps player ${JSON.stringify({player,panel})}`).toBe(false);
      for(let i=0;i<data.players.length;i++) for(let j=i+1;j<data.players.length;j++) expect(overlaps(data.players[i],data.players[j]),`${width}/${count}: player overlap ${JSON.stringify(data.players)}`).toBe(false);
      if(record.game.reveal) {
        expect(data.trumpMarks.every(value=>value==='hidden')).toBe(true);
        expect(data.occluded,`${width}/${count}: trump hidden`).toBe('false');
        for(const card of [...data.projected,data.slot]) for(const player of data.players) expect(overlaps(card,player),`${width}/${count}: trump overlaps avatar`).toBe(false);
      }
      const lead=leadInfo(record.game);
      await expect(page.locator('.lead-callout')).toContainText(record.game.players[lead.seat].name);
      await expect(page.locator('.lead-badge')).toHaveCount(1);
      const bids=page.locator('.bid-options');
      await bids.evaluate(el=>{el.scrollLeft=el.scrollWidth;});
      await expect(page.locator('[data-bid]').last()).toBeInViewport();
      await bids.evaluate(el=>{el.scrollLeft=0;});
      if(count===6 && [1440,390,844].includes(width)) {
        await expect(page.locator('#notice')).toBeEmpty({timeout:6000});
        await page.screenshot({path:`${out}/table-clarity-bid-${width}.png`});
      }
      await page.locator('.player .avatar').first().click();
      await expect(page.locator('#table-score-panel')).toBeVisible();
      await page.locator('.close-scores').click();
      await page.locator('#table-menu').click();
      await expect(page.locator('#leave')).toBeVisible();
      await expect(page.locator('#room-dissolve')).toBeVisible();
      await page.locator('#table-menu').click();
      checks.push({width,height,count,phase:'bid',cards:record.game.cardsPerRound,clear:true});
      await context.close();
    }
  }
  for(const [width,height] of [[360,640],[844,390]]) {
    const {page,context}=await open(fixture(3,20,'bid'),width,height,false);
    await page.locator('.bid-options').evaluate(el=>{el.scrollLeft=el.scrollWidth;});
    await expect(page.locator('[data-bid="20"]')).toBeInViewport();
    await page.locator('[data-bid="20"]').click();
    await expect(page.locator('[data-bid]')).toHaveCount(0);
    checks.push({width,highestBidReachable:20});await context.close();
  }
  }
  // Check the actual leader before bidding and after trick/round settlement,
  // including the viewer's own avatar and the CSS fallback.
  for(const webgl of [true,false]) for(const phase of ['bid','trickEnd','roundEnd']) {
    const record=fixture(4,2,phase,'hidden',true);
    const {page,context}=await open(record,390,844,webgl);
    await expect(page.locator('.own-status .lead-badge')).toBeVisible();
    await expect(page.locator('.lead-callout')).toContainText('· 你');
    await expect(page.locator('.lead-badge')).toHaveCount(1);
    checks.push({phase,webgl,selfLeader:true});await context.close();
  }
  // Home directory remains inside the menu even when populated and scrolled.
  for(const [width,height] of [[1440,900],[390,844]]) {
    const context=await browser.newContext({viewport:{width,height},reducedMotion:'reduce'});
    const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
    await page.goto(base);await page.locator('.scene-host.ready').waitFor();
    await page.evaluate(async()=>{
      const {RoomDirectory}=await import('/src/room-directory.js');
      const dir=new RoomDirectory();dir.mount(document.querySelector('.home-room-list'));
      document.querySelectorAll('.room-directory')[0].remove();
      dir.update({status:'online',rooms:Array.from({length:5},(_,i)=>({room:`TABLE22${i+2}`,hostName:'远帆探险的旅人',phase:'play',round:3,maxRounds:10,players:6,spectators:i}))});
    });
    const home=await page.evaluate(()=>{
      const a=document.querySelector('.home-room-list').getBoundingClientRect(),b=document.querySelector('.home-menu').getBoundingClientRect();
      return {contained:a.left>=b.left&&a.right<=b.right,overflow:document.documentElement.scrollWidth>innerWidth};
    });
    expect(home.contained).toBe(true);expect(home.overflow).toBe(false);
    await page.locator('.home-room-list').scrollIntoViewIfNeeded();
    await page.locator('.room-directory-list').evaluate(el=>el.scrollTop=el.scrollHeight);
    await expect(page.locator('.room-directory-watch').last()).toBeInViewport();
    await page.screenshot({path:`${out}/table-clarity-home-${width}.png`,fullPage:true});
    checks.push({home:width,contained:true});await context.close();
  }
  expect(errors).toEqual([]);console.log(JSON.stringify({checks,errors}));
} finally {await browser.close();}
