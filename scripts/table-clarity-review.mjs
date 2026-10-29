import { chromium, expect } from '@playwright/test';
import fs from 'node:fs';
import { createGame, addPlayer, act, viewFor, winner } from '../src/game.js';
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
  for (let i=0;i<count;i++) addPlayer(game,`p${i}`,['远帆探险的旅人','青山学徒的长昵称','青山守林的长昵称','青山远航的长昵称','星河','林语'][i]);
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
async function open(record,width,height,webgl=true,reducedMotion='reduce',trumpMotion=false) {
  const context=await browser.newContext({viewport:{width,height},hasTouch:width<1000,reducedMotion});
  await context.addInitScript(({record,webgl,trumpMotion})=>{
    record.game.turnDeadline=Date.now()+30000;
    sessionStorage.setItem('wizard-room-session',JSON.stringify(record));
    localStorage.setItem('wizard-trump-motion',String(trumpMotion));
    localStorage.setItem('wizard-low-graphics','true');
    if(!webgl) {
      const get=HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext=function(kind,...args){return kind.startsWith('webgl')?null:get.call(this,kind,...args)};
    }
  },{record,webgl,trumpMotion});
  const page=await context.newPage(); page.on('pageerror',e=>errors.push(e.message));
  await page.route(/\/src\/table-scene\.js(?:\?|$)/,async route=>{
    const response=await route.fetch();
    await route.fulfill({response,body:(await response.text()).replace('this.animate(0);','window.__clarityScene=this;this.animate(0);')});
  });
  if(['playfield','trump'].includes(process.env.CLARITY_CASE)) await page.route(/\/src\/main\.js(?:\?|$)/,async route=>{
    const response=await route.fetch();
    // Browser-only instrumentation of the fetched development module. The
    // application and Worker expose no arbitrary-state endpoint.
    const instrument=`
window.__clarityApply=async(next,{initial=false,role='host',practiceMode=true}={})=>{
  clearTimeout(turnTimer);clearTimeout(botTimer);game=next;me='p0';
  if(game.phase==='play')game.turnDeadline=Date.now()+30000;
  practice=practiceMode;isHost=role==='host';spectating=role==='spectator';networkReady=true;
  const {spectatorView}=await import('/src/game.js');
  state=spectating?spectatorView(game):viewFor(game,me);
  state.lifecycle=next.lifecycle||{};updateEventEffects(initial);render();
};
window.__clarityMotion=tableMotion;
window.__clarityReveal=trumpReveal;
window.__clarityRedraw=render;
window.__clarityLoadId=crypto.randomUUID();
window.__claritySnapshot=()=>({round:state.round,phase:state.phase,eventSeq:state.eventSeq,gameTrick:game.trick.length,stateTrick:state.trick.length,loadId:window.__clarityLoadId});
`;
    await route.fulfill({response,body:await response.text()+instrument});
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
      trumpPresentation:document.querySelector('.trump-display')?.dataset.presentation,
      projected,flat:document.querySelector('.player')?getComputedStyle(document.querySelector('.player')).backgroundColor:null,
      trumpMarks:[...document.querySelectorAll('.trump-card .corner')].map(el=>getComputedStyle(el).visibility),
      overlay:getComputedStyle(document.querySelector('.scene-host'),'::after').display,
      pauseVisible:shown(document.querySelector('#room-pause')),
    };
  },webgl);
}

function trickSequence(count) {
  const record=fixture(count,8,'play'), game=record.game;
  const snapshots=[structuredClone(game)];
  while(game.phase==='play') {
    const player=game.players[game.turn], legal=viewFor(game,player.id).legal;
    // Prefer a legal overtaking card so this also exercises emphasis transfer;
    // the shared engine remains the only source of winning-card decisions.
    const card=legal.map(id=>player.hand.find(card=>card.id===id)).find(card=>
      winner([...game.trick,{player:game.turn,card}],game.trump,game.options.deckMode)===game.turn
    ) || player.hand.find(card=>card.id===legal[0]);
    act(game,player.id,{type:'play',card:card.id});snapshots.push(structuredClone(game));
  }
  return {record:{...record,game:snapshots[0]},snapshots};
}
async function playfieldGeometry(page,webgl) {
  return page.evaluate(webgl=>{
    const rect=node=>{const r=node.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}};
    const shown=node=>{const s=getComputedStyle(node),r=node.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0};
    const nodes=[...document.querySelectorAll('.played')], scene=window.__clarityScene;
    const canvas=scene?.renderer.domElement.getBoundingClientRect();
    let trumpFace=null;
    if(webgl&&scene?.trump.visible){
      scene.trump.updateMatrixWorld(true);const mesh=scene.trumpFace,{width,height}=mesh.geometry.parameters,points=[];
      for(const x of [-width/2,width/2])for(const y of [-height/2,height/2]){
        const p=mesh.position.clone().set(x,y,0).applyMatrix4(mesh.matrixWorld).project(scene.camera);
        points.push({x:canvas.left+(p.x+1)*canvas.width/2,y:canvas.top+(1-p.y)*canvas.height/2});
      }
      trumpFace={left:Math.min(...points.map(p=>p.x)),right:Math.max(...points.map(p=>p.x)),top:Math.min(...points.map(p=>p.y)),bottom:Math.max(...points.map(p=>p.y))};
    }
    const cards=nodes.map(node=>{
      const group=scene?.cards.get(node.dataset.cardId),face=group?.userData.face;
      let physical=null,edge=null;
      if(webgl&&face){
        group.updateMatrixWorld(true);const {width,height}=face.geometry.parameters,points=[];
        for(const x of [-width/2,width/2])for(const y of [-height/2,height/2]){
          const p=face.position.clone().set(x,y,0).applyMatrix4(face.matrixWorld).project(scene.camera);
          points.push({x:canvas.left+(p.x+1)*canvas.width/2,y:canvas.top+(1-p.y)*canvas.height/2});
        }
        physical={left:Math.min(...points.map(p=>p.x)),right:Math.max(...points.map(p=>p.x)),top:Math.min(...points.map(p=>p.y)),bottom:Math.max(...points.map(p=>p.y))};
        physical.width=physical.right-physical.left;physical.height=physical.bottom-physical.top;
        const mesh=group.userData.edge;mesh.geometry.computeBoundingBox();const box=mesh.geometry.boundingBox,points3=[];
        for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z]){
          const p=mesh.position.clone().set(x,y,z).applyMatrix4(mesh.matrixWorld).project(scene.camera);
          points3.push({x:canvas.left+(p.x+1)*canvas.width/2,y:canvas.top+(1-p.y)*canvas.height/2});
        }
        edge={left:Math.min(...points3.map(p=>p.x)),right:Math.max(...points3.map(p=>p.x)),top:Math.min(...points3.map(p=>p.y)),bottom:Math.max(...points3.map(p=>p.y))};
      }
      const label=node.querySelector(':scope > small'),card=node.querySelector('.card'),box=node.getBoundingClientRect();
      return {id:node.dataset.cardId,player:node.dataset.player,seat:+node.dataset.playSeat,
        winner:node.classList.contains('winner'),badge:getComputedStyle(node,'::before').content,label:label.textContent,labelRect:rect(label),face:physical||rect(card),edge:edge||rect(card),
        base:{x:box.left+card.offsetLeft+card.offsetWidth/2,y:box.top+card.offsetTop+card.offsetHeight/2,width:card.offsetWidth,height:card.offsetHeight},
        enter:scene?.motion?.pose(node.dataset.cardId).enter,
        marks:[...card.querySelectorAll('.corner')].map(mark=>getComputedStyle(mark).visibility)};
    });
    return {width:innerWidth,height:innerHeight,scrollX,scrollY,fixture:window.__claritySnapshot?.(),mode:document.querySelector('.table').dataset.layoutMode,
      playedWidth:parseFloat(document.querySelector('.played-cards').style.getPropertyValue('--played-width')),
      overflow:document.documentElement.scrollWidth>innerWidth,cards,
      obstacles:[...document.querySelectorAll('.opponents .player,.own-status,.action-panel,.hand-section,.hand .card.selected,.game-toolbar,.roundbar')].filter(shown).map(rect),
      identities:[...document.querySelectorAll('.opponents .player,.own-status')].filter(shown).map(rect),
      controls:[...document.querySelectorAll('.game-toolbar,#chat-toggle,.table-trump,.play-confirm')].filter(shown).map(rect),
      trump:{presentation:document.querySelector('.trump-display')?.dataset.presentation,
        rect:rect(document.querySelector('.trump-display')),physical:scene?.trump.visible,
        anchor:document.querySelector('.trump-card')?rect(document.querySelector('.trump-card')):null,face:trumpFace,
        visibleFaceParts:[...document.querySelectorAll('.trump-card,.trump-card *')].filter(shown).length,
        label:document.querySelector('.table-trump')?.textContent},
      names:[...document.querySelectorAll('.opponents .player')].map(node=>({player:node.dataset.player,label:node.textContent,short:node.querySelector('.seat-name')?.textContent,aria:node.getAttribute('aria-label')}))};
  },webgl);
}
function verifyPlayfield(data,count,expectedWinner,webgl) {
  expect(data.overflow).toBe(false);expect(data.scrollY).toBe(0);
  for(const identity of data.identities)for(const control of data.controls)expect(overlaps(identity,control),`${data.width}x${data.height}: player identity is hidden by a control`).toBe(false);
  if(data.trump.presentation==='badge') {
    expect(data.trump.visibleFaceParts,'badge must hide its complete miniature-card subtree').toBe(0);
    if(webgl)expect(data.trump.physical).toBe(false);
  }
  if(webgl&&data.trump.presentation==='card'&&data.trump.anchor?.width){
    expect(data.trump.physical).toBe(true);const {face,anchor}=data.trump;
    expect(face.left).toBeGreaterThanOrEqual(anchor.left-1);expect(face.right).toBeLessThanOrEqual(anchor.right+1);
    expect(face.top).toBeGreaterThanOrEqual(anchor.top-1);expect(face.bottom).toBeLessThanOrEqual(anchor.bottom+1);
    expect(face.right-face.left,'actual trump face remains readable inside its motion envelope').toBeGreaterThanOrEqual(data.mode==='strip'?44:60);
    for(const card of data.cards)expect(overlaps(card.edge,face),'trump is separate from the trick').toBe(false);
  }
  expect(data.cards).toHaveLength(count);
  if(count) expect(data.cards.filter(card=>card.winner).map(card=>card.player)).toEqual([expectedWinner]);
  if(count) expect(data.cards.find(card=>card.winner).badge).toContain(['trickEnd','roundEnd','finished'].includes(data.fixture.phase)?'赢得本墩':'当前最大');
  for(const card of data.cards){
    expect(Math.abs(card.base.width-data.playedWidth),'CSS card width must match the shared reserved layout width').toBeLessThanOrEqual(1);
    expect(card.edge.left,`${data.width}: ${card.id} left`).toBeGreaterThanOrEqual(-1);
    expect(card.edge.right,`${data.width}: ${card.id} right`).toBeLessThanOrEqual(data.width+1);
    expect(card.edge.top,`${data.width}: ${card.id} top`).toBeGreaterThanOrEqual(-1);
    expect(card.edge.bottom,`${data.width}: ${card.id} bottom`).toBeLessThanOrEqual(data.height+1);
    for(const obstacle of data.obstacles) {
      expect(overlaps(card.edge,obstacle),`${data.width}x${data.height}: physical ${card.id} overlaps ${JSON.stringify(obstacle)}`).toBe(false);
      expect(overlaps(card.labelRect,obstacle),`${data.width}x${data.height}: owner ${card.id} overlaps controls`).toBe(false);
    }
    expect(overlaps(card.edge,card.labelRect),`${data.width}: enlarged card hides its owner`).toBe(false);
    for(const other of data.cards.filter(other=>other.id!==card.id)) {
      expect(overlaps(card.edge,other.edge),`${data.width}: physical cards overlap`).toBe(false);
      expect(overlaps(card.edge,other.labelRect),`${data.width}: physical card hides owner`).toBe(false);
    }
    expect(Math.abs((card.face.left+card.face.right)/2-card.base.x),'physical face stays at owner anchor').toBeLessThanOrEqual(2);
    expect(card.face.width/card.base.width).toBeCloseTo(card.winner ? data.mode==='strip'?1.15:1.22 : 1,1);
    expect(card.marks.every(value=>value===(webgl?'hidden':'visible'))).toBe(true);
  }
}
async function visibleButton(page,selector) {
  const result=await page.locator(selector).evaluate(button=>{
    const r=button.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;
    return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:innerWidth,height:innerHeight,
      unblocked:button.contains(document.elementFromPoint(x,y)),scrollY};
  });
  expect(result.scrollY).toBe(0);expect(result.left).toBeGreaterThanOrEqual(0);
  expect(result.right).toBeLessThanOrEqual(result.width);expect(result.top).toBeGreaterThanOrEqual(0);
  expect(result.bottom).toBeLessThanOrEqual(result.height);expect(result.unblocked).toBe(true);
}
async function reviewPlayfield() {
  const section=process.env.PLAYFIELD_SECTION,viewport=process.env.PLAYFIELD_VIEWPORT;
  const counts=(process.env.PLAYFIELD_COUNTS||'3,4,5,6').split(',').map(Number);
  const wanted=([width,height])=>!viewport||viewport===`${width}x${height}`;
  const viewports=[[1440,900],[844,390],[932,430],[844,300],[390,844],...(viewport==='360x640'?[[360,640]]:[])].filter(wanted);
  if(!section||section==='cards') {
  for(const [width,height] of viewports) for(const count of counts) {
    const {record,snapshots}=trickSequence(count),{page,context}=await open(record,width,height);
    const anchors=new Map();let previousWinner=null,switches=0;
    const loadId=await page.evaluate(()=>window.__clarityLoadId);
    for(const [index,snapshot] of snapshots.entries()) {
      await page.evaluate(async game=>window.__clarityApply(game,{initial:true}),snapshot);
      await page.waitForTimeout(120);
      const data=await playfieldGeometry(page,true),winning= snapshot.trick.length ? snapshot.players[winner(snapshot.trick,snapshot.trump,snapshot.options.deckMode)].id : null;
      try {
        expect(data.fixture.loadId,'development source reloaded during the scenario').toBe(loadId);
        expect(data.fixture.stateTrick).toBe(index);verifyPlayfield(data,index,winning,true);
      }
      catch(error) {
        fs.writeFileSync(`${out}/playfield-failure-${width}x${height}-${count}-${index}.json`,JSON.stringify(data,null,2));
        await page.screenshot({path:`${out}/playfield-failure-${width}x${height}-${count}-${index}.png`});
        throw error;
      }
      expect(data.mode).toBe(width>=600&&height<=540?'strip':width<600&&height<=700?'portrait-grid':'ring');
      if(previousWinner&&winning!==previousWinner)switches++;previousWinner=winning;
      for(const card of data.cards){
        if(anchors.has(card.id)) expect(card.base).toEqual(anchors.get(card.id));
        else anchors.set(card.id,card.base);
      }
      if(index===0) anchors.set('trump',data.trump.rect);
      else expect(data.trump.rect).toEqual(anchors.get('trump'));
      if(count===6&&index===4&&[1440,844].includes(width)){
        const legal=page.locator('.hand .card.playable');
        await (await legal.count()?legal.first():page.locator('.hand .card').first()).click({position:{x:12,y:36}});
        await expect(page.locator('.hand .selected')).toHaveCount(1);await visibleButton(page,'#confirm-play');
        if(snapshot.players[snapshot.turn].id==='p0')await expect(page.locator('#confirm-play')).toBeEnabled();
        await expect(page.locator('#notice')).toBeEmpty({timeout:6000});
        await page.waitForTimeout(160);verifyPlayfield(await playfieldGeometry(page,true),index,winning,true);
        await page.screenshot({path:`${out}/playfield-live-selected-${width}x${height}-3d.png`});
        await page.locator('#cancel-card').click();
      }
      if(index===count&&count===6){
        expect(new Set(data.names.map(name=>name.short)).size).toBe(5);
        for(const name of data.names.filter(name=>/^p[123]$/.test(name.player))) expect(name.aria).toContain('青山');
        await expect(page.locator('#notice')).toBeEmpty({timeout:6000});
        await page.screenshot({path:`${out}/playfield-six-${width}x${height}-3d.png`});
        fs.writeFileSync(`${out}/playfield-six-${width}x${height}.json`,JSON.stringify(data,null,2));
        if(data.trump.presentation==='badge'&&record.game.reveal){
          expect(data.trump.physical).toBe(false);
          await page.locator('.table-trump').click();await expect(page.locator('.trump-preview')).toBeVisible();
          const preview=await page.locator('.trump-preview-face').boundingBox();
          expect(preview.width).toBeGreaterThanOrEqual(90);expect(preview.height).toBeGreaterThanOrEqual(135);
          expect(preview.y).toBeGreaterThanOrEqual(0);expect(preview.y+preview.height).toBeLessThanOrEqual(height);
          await page.getByRole('button',{name:'返回牌桌',exact:true}).click();await expect(page.locator('.trump-preview')).toHaveCount(0);
          await visibleButton(page,'#next');
        }
      }
    }
    checks.push({width,height,count,fullTrick:true,stableSlots:true,physicalProjection:true,leaderSwitches:switches});
    await context.close();
  }
  // The fallback has the same ownership, winner and layout at both sides of
  // the former 850px breakpoint and in the constrained toolbar-height case.
  for(const [width,height] of [[844,390],[932,430],[844,300],[390,844]].filter(wanted)) {
    const {record,snapshots}=trickSequence(6),{page,context}=await open(record,width,height,false);
    const game=snapshots.at(-1);await page.evaluate(game=>window.__clarityApply(game,{initial:true}),game);await page.waitForTimeout(120);
    const data=await playfieldGeometry(page,false);
    verifyPlayfield(data,6,game.players[winner(game.trick,game.trump,game.options.deckMode)].id,false);
    await page.screenshot({path:`${out}/playfield-six-${width}x${height}-2d.png`});
    checks.push({width,height,count:6,fallback:true});await context.close();
  }
  }
  if(!section||section==='settlement') {
  for(const [width,height] of viewports) {
    const {page,context}=await open(fixture(6,8,'trickEnd'),width,height);
    for(const phase of ['trickEnd','roundEnd','finished']){
      const record=fixture(6,phase==='finished'?10:8,phase);
      await page.evaluate(game=>window.__clarityApply(game,{initial:true}),record.game);await page.waitForTimeout(120);
      const selector=phase==='finished'?'#rematch':'#next';await expect(page.locator(selector)).toBeVisible();
      await visibleButton(page,selector);await expect(page.locator('.win-reason')).toHaveCount(0);
      const details=page.locator('.settlement-details');
      if(await details.count()){
        expect(await details.getAttribute('open')).toBeNull();
        await details.locator('summary').click();await visibleButton(page,selector);
        await details.locator('summary').click();
      }
      await expect(page.locator('#notice')).toBeEmpty({timeout:6000});await page.waitForTimeout(150);
      await page.screenshot({path:`${out}/settlement-${phase}-${width}x${height}.png`});
      if(phase==='finished')await expect(page.locator('#next')).toHaveCount(0);
      checks.push({width,height,phase,ctaInInitialViewport:true});
    }
    await context.close();
  }
  {
    const {page,context}=await open(fixture(6,8,'roundEnd'),844,300);
    for(const phase of ['roundEnd','finished']) for(const role of ['guest','spectator']) {
      const record=fixture(6,phase==='finished'?10:8,phase);
      await page.evaluate(async({game,role})=>window.__clarityApply(game,{initial:true,role,practiceMode:false}),{game:record.game,role});
      await expect(page.locator('#next,#rematch,#confirm-results')).toHaveCount(0);
      await expect(page.locator('.settlement-summary')).toBeVisible();
      checks.push({width:844,height:300,phase,role,noUnauthorizedAdvance:true});
    }
    const offline=fixture(6,8,'roundEnd').game;offline.players[1].online=false;
    await page.evaluate(game=>window.__clarityApply(game,{initial:true,practiceMode:false}),offline);
    await expect(page.locator('#next')).toBeDisabled();await visibleButton(page,'#next');
    const closing=fixture(6,8,'roundEnd').game;closing.lifecycle={closeAfterRound:true,resultsConfirmed:[]};
    await page.evaluate(game=>window.__clarityApply(game,{initial:true,practiceMode:false}),closing);
    await expect(page.locator('#next,#rematch')).toHaveCount(0);await visibleButton(page,'#confirm-results');
    const next=fixture(6,8,'roundEnd').game;
    await page.evaluate(game=>window.__clarityApply(game,{initial:true}),next);
    await page.locator('#next').evaluate(button=>{button.click();button.click();button.click();});
    expect(await page.evaluate(()=>window.__claritySnapshot().round)).toBe(9);
    expect(await page.evaluate(()=>window.__claritySnapshot().phase)).toMatch(/bid|trump/);
    checks.push({width:844,height:300,offlineHostDisabled:true,closingConfirmationVisible:true,repeatedClickAdvancedOnce:true});await context.close();
  }
  }
  if(section==='capture') for(const [width,height] of viewports.filter(([width])=>[1440,844].includes(width))) {
    const {record,snapshots}=trickSequence(6),game=snapshots[4];
    const {page,context}=await open({...record,game},width,height);
    await expect(page.locator('#notice')).toBeEmpty({timeout:6000});
    await page.locator('.hand .card.playable').first().click({position:{x:12,y:36}});
    await expect(page.locator('#confirm-play')).toBeEnabled();await visibleButton(page,'#confirm-play');
    await page.waitForTimeout(160);
    verifyPlayfield(await playfieldGeometry(page,true),4,game.players[winner(game.trick,game.trump,game.options.deckMode)].id,true);
    await page.screenshot({path:`${out}/playfield-live-selected-${width}x${height}-3d.png`});
    checks.push({width,height,livePlayCapture:true,legalSelection:true,confirmInInitialViewport:true});await context.close();
  }
  // Ordinary animation is interruptible: resize mid-entry, repeat the same
  // state and restore the final snapshot without replaying cards.
  if(!section||section==='motion') {
  const {record,snapshots}=trickSequence(6),{page,context}=await open(record,844,390,true,'no-preference');
  for(const [index,game] of snapshots.slice(1,4).entries()){
    for(const event of game.events)if(event.type==='play'&&event.card?.id===game.trick.at(-1).card.id)event.time=Date.now();
    await page.evaluate(game=>window.__clarityApply(game),game);await page.waitForTimeout(60);
    if(index===0)await page.setViewportSize({width:932,height:430});
    const before=await page.evaluate(()=>Object.fromEntries([...window.__clarityMotion.entries]));
    await page.evaluate(game=>window.__clarityApply(game),game);
    expect(await page.evaluate(()=>Object.fromEntries([...window.__clarityMotion.entries]))).toEqual(before);
  }
  const full=snapshots.at(-1);await page.evaluate(game=>window.__clarityApply(game,{initial:true}),full);await page.waitForTimeout(120);
  let data=await playfieldGeometry(page,true);expect(data.cards.every(card=>card.enter===1)).toBe(true);
  verifyPlayfield(data,6,full.players[winner(full.trick,full.trump,full.options.deckMode)].id,true);
  const paused=structuredClone(full);paused.lifecycle={paused:true};
  await page.evaluate(game=>window.__clarityApply(game,{initial:true}),paused);
  const frozen=await page.evaluate(()=>({time:window.__clarityMotion.clock(),entries:Object.fromEntries(window.__clarityMotion.entries)}));
  for(const [width,height] of [[844,390],[390,844],[932,430]]){
    await page.setViewportSize({width,height});
    await expect.poll(async()=>{
      const layout=await playfieldGeometry(page,true),leader=layout.cards.find(card=>card.winner);
      return layout.mode===(width>=600&&height<=540?'strip':'ring')&&leader ? leader.face.width/leader.base.width : 0;
    }).toBeCloseTo(width>=600&&height<=540?1.15:1.22,2);
    expect(await page.evaluate(()=>({time:window.__clarityMotion.clock(),entries:Object.fromEntries(window.__clarityMotion.entries)}))).toEqual(frozen);
    data=await playfieldGeometry(page,true);verifyPlayfield(data,6,full.players[winner(full.trick,full.trump,full.options.deckMode)].id,true);
  }
  await page.emulateMedia({reducedMotion:'reduce'});
  await expect.poll(()=>page.evaluate(()=>window.__clarityMotion.reducedMotion)).toBe(true);
  expect(await page.evaluate(()=>window.__clarityMotion.isAnimating())).toBe(false);
  expect(await page.evaluate(()=>({time:window.__clarityMotion.clock(),entries:Object.fromEntries(window.__clarityMotion.entries)}))).toEqual(frozen);
  checks.push({pausedResize:true,pausedClockFrozen:true,pausedEntriesStable:true,dynamicReducedMotion:true});
  await page.evaluate(game=>window.__clarityApply(game,{initial:true}),full);await page.emulateMedia({reducedMotion:'no-preference'});
  await page.setViewportSize({width:390,height:844});
  await expect.poll(async()=>{
    const layout=await playfieldGeometry(page,true),leader=layout.cards.find(card=>card.winner);
    return layout.mode==='ring'&&leader ? leader.face.width/leader.base.width : 0;
  }).toBeCloseTo(1.22,2);
  data=await playfieldGeometry(page,true);verifyPlayfield(data,6,full.players[winner(full.trick,full.trump,full.options.deckMode)].id,true);
  checks.push({normalMotion:true,interruptedResize:true,noRepeatedArrival:true,rotated:true});await context.close();
  const restored=await open({...record,game:full},844,390,true,'no-preference');
  const recovered=await playfieldGeometry(restored.page,true);
  expect(recovered.cards).toHaveLength(6);expect(recovered.cards.every(card=>card.enter===1)).toBe(true);
  await expect(restored.page.locator('.played.card-enter')).toHaveCount(0);
  verifyPlayfield(recovered,6,full.players[winner(full.trick,full.trump,full.options.deckMode)].id,true);
  checks.push({restoredWithoutReplay:true,normalMotion:true});await restored.context.close();
  }
  expect(errors).toEqual([]);fs.writeFileSync(`${out}/playfield-${section?section+'-':''}${viewport?viewport+'-':''}results.json`,JSON.stringify({checks,errors},null,2));
  console.log(JSON.stringify({checks,errors}));
}
try {
  if(process.env.CLARITY_CASE==='trump') await reviewTrump();
  else if(process.env.CLARITY_CASE==='playfield') await reviewPlayfield();
  else {
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
        expect(data.occluded,`${width}/${count}: trump presentation`).toBe(data.trumpPresentation==='badge'?'true':'false');
        if(data.trumpPresentation==='card') for(const card of [...data.projected,data.slot]) for(const player of data.players) expect(overlaps(card,player),`${width}/${count}: trump overlaps avatar`).toBe(false);
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
    if(phase==='bid') await expect(page.locator('.lead-callout')).toContainText('· 你');
    else {
      await expect(page.locator('.settlement-summary')).toBeVisible();
      await visibleButton(page,'#next');
    }
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
  }
} finally {await browser.close();}

// Focused local reveal checks reuse this harness, legal engine fixtures and
// its response-only instrumentation. No production test endpoint or CI matrix.
function turnedFixture(kind) {
  for(let seed=1;seed<=250;seed++) {
    const game=createGame();game.randomState=createRandomStream(Array(11).fill(seed));
    for(let i=0;i<6;i++)addPlayer(game,`p${i}`,['远帆','青山','清月','星河','林语','云舒'][i]);
    game.options={...DEFAULT_OPTIONS,predictionMode:'hidden'};
    const lobby=structuredClone(game);
    act(game,'p0',{type:'start',options:game.options});
    if(game.reveal?.kind===kind && (kind!=='number'||game.trump==='yellow'))
      return {lobby,record:{version:1,role:'practice',room:'离线练习',me:'p0',game,identities:{}}};
  }
  throw Error(`No legal ${kind} reveal fixture`);
}
async function beginReveal(page,lobby,next) {
  await page.evaluate(async({lobby,next})=>{
    const reveal=window.__clarityReveal;reveal.clock=()=>performance.now();
    await window.__clarityApply(lobby,{initial:true});
    const copy=structuredClone(next);for(const event of copy.events)event.time=Date.now();
    await window.__clarityApply(copy);
  },{lobby,next});
}
async function holdReveal(page,elapsed=620) {
  await page.evaluate(elapsed=>{
    const reveal=window.__clarityReveal;if(!reveal.effect)throw Error('Expected a live reveal');
    const at=reveal.effect.start+elapsed;reveal.clock=()=>at;reveal.draw();
  },elapsed);
}
async function revealGeometry(page) {
  return page.evaluate(()=>{
    const rect=n=>{const r=n.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}};
    const shown=n=>n.offsetWidth&&n.offsetHeight&&getComputedStyle(n).visibility!=='hidden';
    const reveal=window.__clarityReveal,root=document.querySelector('.trump-reveal');
    const domDeck=document.querySelector('.prop-deck');
    const card=root?.querySelector('.trump-reveal-card'),label=root?.querySelector('.trump-reveal-label');
    return {root:!!root,key:root?.dataset.key,phase:root?.dataset.phase,card:card?rect(card):null,
      label:label?{...rect(label),text:label.textContent,opacity:getComputedStyle(label).opacity}:null,
      badge:rect(document.querySelector('.table-trump')),icon:rect(document.querySelector('.trump-suit-icon')),
      origin:reveal.geometry?.origin,center:reveal.geometry?.center,deck:window.__clarityScene?.deckScreenRect(),
      domDeck:!document.body.classList.contains('has-webgl')&&domDeck&&shown(domDeck)?rect(domDeck):null,
      hiddenDeck:window.__clarityScene?.deck.visible===false,
      physical:window.__clarityScene?.trump.visible,overlayCount:document.querySelectorAll('.trump-reveal-card').length,
      pointer:root?getComputedStyle(root).pointerEvents:null,face:root?.querySelector('.trump-reveal-front')?.style.backgroundImage,
      rotor:root?.querySelector('.trump-reveal-rotor')?.style.transform,
      obstacles:[...document.querySelectorAll('.opponents .player,.own-status,.hand-section,.action-panel,.game-toolbar,.roundbar')].filter(shown).map(rect),
      overflow:document.documentElement.scrollWidth>innerWidth};
  });
}
async function assertSettled(page,label) {
  await expect(page.locator('.table-trump')).toContainText(label);
  await expect(page.locator('.trump-reveal,.trump-card')).toHaveCount(0);
  if(await page.locator('body').evaluate(body=>body.classList.contains('has-webgl')))
    expect(await page.evaluate(()=>window.__clarityScene.trump.visible)).toBe(false);
  const still=await page.locator('.trump-suit-icon').evaluate(node=>({filter:node.style.filter,animations:node.getAnimations().length}));
  expect(still).toEqual({filter:'',animations:0});
}
async function reviewTrump() {
  const normal=turnedFixture('number'),wizard=turnedFixture('wizard'),jester=turnedFixture('jester');
  for(const [width,height,webgl] of [[1440,900,true],[844,390,true],[844,390,false],[390,844,false],[844,300,true]]) {
    const {page,context}=await open(normal.record,width,height,webgl,'no-preference',true);
    await assertSettled(page,'主牌：黄色'); // Restored practice never replays.
    await beginReveal(page,normal.lobby,normal.record.game);
    await holdReveal(page,100);
    await expect(page.locator('.trump-reveal')).toHaveAttribute('data-phase','extract');
    expect(await page.locator('.trump-reveal-rotor').evaluate(node=>node.style.transform)).toBe('rotateY(180deg)');
    if(width===1440)await page.screenshot({path:`${out}/trump-extract-desktop.png`});
    await holdReveal(page,320);await expect(page.locator('.trump-reveal')).toHaveAttribute('data-phase','flip');
    await holdReveal(page);
    const data=await revealGeometry(page);
    expect(data.phase).toBe('hold');expect(data.overlayCount).toBe(1);expect(data.physical).not.toBe(true);
    expect(data.rotor).toBe('rotateY(0deg)');expect(data.face).toContain('yellow-');expect(data.label.text).toContain('本轮主牌：黄色');
    expect(Number(data.label.opacity)).toBe(1);expect(data.pointer).toBe('none');expect(data.overflow).toBe(false);
    for(const obstacle of data.obstacles) {
      expect(overlaps(data.card,obstacle),`${width}x${height}: reveal overlaps ${JSON.stringify(obstacle)}`).toBe(false);
      expect(overlaps(data.label,obstacle),`${width}x${height}: reveal label overlaps ${JSON.stringify(obstacle)}`).toBe(false);
      expect(overlaps(data.badge,obstacle),`${width}x${height}: badge overlaps ${JSON.stringify(obstacle)}`).toBe(false);
    }
    if(data.deck)expect(data.origin).toEqual({x:data.deck.left+data.deck.width/2,y:data.deck.top+data.deck.height/2});
    if(data.domDeck)expect(data.origin).toEqual({x:data.domDeck.left+data.domDeck.width/2,y:data.domDeck.top+data.domDeck.height/2});
    if(data.hiddenDeck)expect(data.origin).toEqual({x:data.center.x,y:data.center.y+32});
    if(webgl&&[1440,844].includes(width)&&height!==300)
      await page.screenshot({path:`${out}/trump-reveal-${width}x${height}-20261030.png`});
    // Re-render, duplicate the same state and open the real menu mid-reveal.
    const start=await page.evaluate(()=>{window.__heldReveal=document.querySelector('.trump-reveal');return window.__clarityReveal.effect.start;});
    await page.evaluate(()=>window.__clarityRedraw());await page.locator('#table-menu').click();await page.locator('#table-menu').click();
    await page.evaluate(game=>window.__clarityApply(game),normal.record.game);
    expect(await page.evaluate(()=>window.__heldReveal===document.querySelector('.trump-reveal'))).toBe(true);
    expect(await page.evaluate(()=>window.__clarityReveal.effect.start)).toBe(start);
    // Hit a normal prediction control through the reveal layer.
    await page.locator('[data-bid="0"]').click();await expect(page.locator('.bid-options')).toHaveCount(0);
    expect(await page.evaluate(()=>JSON.parse(sessionStorage.getItem('wizard-room-session')).game.players[0].bid)).toBe(0);
    await holdReveal(page,1150);const landing=await revealGeometry(page);
    expect(Math.hypot((landing.card.left+landing.card.right-landing.icon.left-landing.icon.right)/2,
      (landing.card.top+landing.card.bottom-landing.icon.top-landing.icon.bottom)/2)).toBeLessThan(2);
    await holdReveal(page,1160);await page.evaluate(()=>{const r=window.__clarityReveal;r.clock=()=>r.pulseAt+321;r.draw();});
    await assertSettled(page,'主牌：黄色');
    if(webgl&&[1440,844].includes(width)&&height!==300)
      await page.screenshot({path:`${out}/trump-settled-${width}x${height}-20261030.png`});
    // A fresh real-time run must also finish without the controlled screenshot clock.
    await beginReveal(page,normal.lobby,normal.record.game);
    await expect(page.locator('.trump-reveal')).toHaveCount(1);
    await expect(page.locator('.trump-reveal')).toHaveCount(0,{timeout:2000});
    await expect.poll(()=>page.locator('.trump-suit-icon').evaluate(node=>node.style.filter)).toBe('');
    await page.reload();await page.locator('.own-status').waitFor();await assertSettled(page,'主牌：黄色');
    checks.push({width,height,webgl,ordinary:true,actualLanding:true,oneLayer:true,duplicatesAndMenu:true,bidDuringReveal:true,reloadedWithoutReplay:true});
    await context.close();
  }
  const {page,context}=await open(wizard.record,844,390,true,'no-preference',true);
  await beginReveal(page,wizard.lobby,wizard.record.game);await holdReveal(page);
  await expect(page.locator('.trump-reveal-label')).toHaveText('✦ 等待庄家选择主牌');
  await expect(page.locator('.table-trump')).toContainText('等待庄家选择主牌');
  await expect(page.locator('.trump-reveal-front')).toHaveCSS('background-image',/wizard\.svg/);
  for(const [width,height] of [[844,300],[844,390]]) {
    await page.setViewportSize({width,height});await beginReveal(page,wizard.lobby,wizard.record.game);await holdReveal(page);
    const geometry=await revealGeometry(page);
    for(const obstacle of geometry.obstacles) {
      expect(overlaps(geometry.card,obstacle),'wizard face leaves controls usable').toBe(false);
      expect(overlaps(geometry.label,obstacle),'pending text leaves controls readable').toBe(false);
      expect(overlaps(geometry.badge,obstacle),'pending badge avoids players and toolbar').toBe(false);
    }
  }
  await page.screenshot({path:`${out}/trump-wizard-pending-844x390-20261030.png`});
  // Actual dealer action cancels a pending reveal and emphasizes the new suit.
  await page.locator('[data-trump="yellow"]').click();
  await expect(page.locator('.trump-reveal')).toHaveCount(0);
  await expect(page.locator('.table-trump')).toContainText('主牌：黄色');
  expect(await page.evaluate(()=>window.__clarityReveal.pulseAt)).not.toBe(null);
  await page.evaluate(()=>{const r=window.__clarityReveal;r.clock=()=>r.pulseAt+321;r.draw();});
  await assertSettled(page,'主牌：黄色');
  checks.push({wizardActualFace:true,pendingBeforeChoice:true,fastChoiceWithoutRedraw:true});
  await beginReveal(page,jester.lobby,jester.record.game);await holdReveal(page);
  await expect(page.locator('.trump-reveal-front')).toHaveCSS('background-image',/jester\.svg/);
  await expect(page.locator('.trump-reveal-label')).toContainText('本轮无主牌');
  await holdReveal(page,1160);await page.evaluate(()=>{const r=window.__clarityReveal;r.clock=()=>r.pulseAt+321;r.draw();});
  await assertSettled(page,'本轮无主牌');checks.push({jesterRealFace:true,noTrump:true});
  for(const game of [fixture(6,10,'bid').game,(()=>{
    const g=createGame();for(let i=0;i<3;i++)addPlayer(g,`p${i}`,`单色${i}`);
    act(g,'p0',{type:'start',options:{...DEFAULT_OPTIONS,deckMode:'mono'}});return g;
  })()]) {
    expect(game.reveal).toBe(null);await beginReveal(page,normal.lobby,game);
    await expect(page.locator('.trump-reveal')).toHaveCount(0);await expect(page.locator('.table-trump')).toContainText('本轮无主牌');
    checks.push({noInventedCard:game.options.deckMode==='mono'?'mono':'exhausted'});
  }
  const many=fixture(6,10,'bid').game;
  await page.evaluate(game=>window.__clarityApply(game,{initial:true}),many);
  const bids=page.locator('.bid-options');
  await bids.evaluate(row=>{row.scrollLeft=row.scrollWidth;});
  const last=await page.locator('[data-bid]').last().getAttribute('data-bid');await visibleButton(page,`[data-bid="${last}"]`);
  await bids.evaluate(row=>{row.scrollLeft=0;});
  const first=await page.locator('[data-bid]').first().getAttribute('data-bid');await visibleButton(page,`[data-bid="${first}"]`);
  checks.push({narrowPredictionDockBothEndsReachable:true});
  for(const phase of [100,600,900]) {
    await beginReveal(page,normal.lobby,normal.record.game);await holdReveal(page,phase);
    await page.setViewportSize(phase===100?{width:932,height:430}:phase===600?{width:844,height:390}:{width:390,height:844});
    await expect(page.locator('.trump-reveal')).toHaveCount(0);await assertSettled(page,'主牌：黄色');
  }
  checks.push({resizeDuringExtractionHoldReturn:true});
  await beginReveal(page,normal.lobby,normal.record.game);await holdReveal(page,600);
  await page.emulateMedia({reducedMotion:'reduce'});await assertSettled(page,'主牌：黄色');
  await beginReveal(page,normal.lobby,normal.record.game);await assertSettled(page,'主牌：黄色');
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.locator('#table-menu').click();await page.locator('#trump-motion').click();await page.locator('#table-menu').click();
  await beginReveal(page,normal.lobby,normal.record.game);await assertSettled(page,'主牌：黄色');
  checks.push({dynamicReducedMotion:true,motionOff:true});await context.close();
  expect(errors).toEqual([]);fs.writeFileSync(`${out}/trump-reveal-review.json`,JSON.stringify({checks,errors},null,2));
  console.log(JSON.stringify({checks,errors}));
}
