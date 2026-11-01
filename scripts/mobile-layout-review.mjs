import { chromium, expect } from '@playwright/test';
import fs from 'node:fs';
import { createGame, addPlayer, act, viewFor } from '../src/game.js';
import { createRandomStream } from '../src/random.js';
import { DEFAULT_OPTIONS } from '../src/rules-options.js';
import { leadInfo } from '../src/table-summary.js';

// Local/manual review: legal saved games exercise the production UI. Inspection
// hooks are appended only to the development response, never the product bundle.
const base=process.env.GAME_URL || 'http://127.0.0.1:5194/';
const out='output/playwright';fs.mkdirSync(out,{recursive:true});
const stamp=process.env.REVIEW_STAMP || 'mobile-layout';
const baseline=process.env.REVIEW_BASELINE==='true';
const browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL || 'chrome',headless:true});
const checks=[],errors=[],failures=[];
const overlap=(a,b)=>a.left<b.right-1&&a.right>b.left+1&&a.top<b.bottom-1&&a.bottom>b.top+1;

function fixture(count,phase,round=3,{ownTurn=true,emptyTrick=false}={}) {
  const game=createGame();game.randomState=createRandomStream(Array(11).fill(8));
  for(let i=0;i<count;i++) addPlayer(game,`p${i}`,['远帆探险的旅人','青山学徒的长昵称','青山守林的长昵称','青山远航的长昵称','星河','林语'][i]);
  act(game,'p0',{type:'start',options:{...DEFAULT_OPTIONS,short:round<=5}});
  for(let step=0;step<15000;step++) {
    if(game.phase===phase&&(phase==='finished'||game.round>=round)
      &&(phase!=='play'||(game.turn===0)===ownTurn&&(!emptyTrick||game.trick.length===0))&&(phase!=='bid'||viewFor(game,'p0').canBid))
      return {version:1,role:'practice',room:'离线练习',me:'p0',game,identities:{}};
    const id=game.players[game.turn].id,view=viewFor(game,id);
    if(game.phase==='trump') act(game,id,{type:'trump',suit:'yellow'});
    else if(game.phase==='bid') act(game,id,{type:'bid',value:view.bids[0]});
    else if(game.phase==='play') act(game,id,{type:'play',card:view.legal[0]});
    else if(['trickEnd','roundEnd'].includes(game.phase)) act(game,'p0',{type:'next'});
    else throw Error(`Unreachable fixture: ${game.phase}`);
  }
  throw Error(`Fixture not reached: ${count} ${phase}`);
}

async function open(record,width,height) {
  const context=await browser.newContext({viewport:{width,height},hasTouch:width<1000,reducedMotion:'reduce'});
  await context.addInitScript(record=>{
    record.game.turnDeadline=Date.now()+600000;
    sessionStorage.setItem('wizard-room-session',JSON.stringify(record));
    localStorage.setItem('wizard-low-graphics','true');
    localStorage.setItem('wizard-trump-motion','false');localStorage.setItem('wizard-turn-sound','false');
  },record);
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  await page.route(/\/src\/main\.js(?:\?|$)/,async route=>{
    const response=await route.fetch();await route.fulfill({response,body:await response.text()+`
      window.__mobileReview={get state(){return state;},get game(){return game;},get scene(){return tableScene;},
        clear(){clearTimeout(turnTimer);clearTimeout(botTimer);notify('');},
        async apply(next){clearTimeout(turnTimer);clearTimeout(botTimer);game=next;me='p0';
          game.turnDeadline=Date.now()+600000;practice=true;isHost=true;spectating=false;networkReady=true;
          state=viewFor(game,me);state.lifecycle={};updateEventEffects(true);render();this.clear();}};`});
  });
  await page.goto(base,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!!window.__mobileReview);
  await page.locator('.table').waitFor();
  await page.waitForFunction(()=>document.body.classList.contains('has-webgl'));
  await page.evaluate(()=>window.__mobileReview.clear());
  await page.waitForTimeout(160);
  return {context,page};
}

async function geometry(page) {
  return page.evaluate(()=>{
    const rect=node=>{const r=node.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};};
    const shown=node=>node&&node.checkVisibility({checkVisibilityCSS:true})&&node.getBoundingClientRect().width>0&&node.getBoundingClientRect().height>0;
    const clippedRect=node=>{
      const raw=rect(node),visible={...raw};
      for(let ancestor=node.parentElement;ancestor;ancestor=ancestor.parentElement) {
        const style=getComputedStyle(ancestor),r=ancestor.getBoundingClientRect();
        if(/auto|scroll|hidden|clip/.test(style.overflowX)){visible.left=Math.max(visible.left,r.left+ancestor.clientLeft);visible.right=Math.min(visible.right,r.left+ancestor.clientLeft+ancestor.clientWidth);}
        if(/auto|scroll|hidden|clip/.test(style.overflowY)){visible.top=Math.max(visible.top,r.top+ancestor.clientTop);visible.bottom=Math.min(visible.bottom,r.top+ancestor.clientTop+ancestor.clientHeight);}
      }
      visible.left=Math.max(0,visible.left);visible.right=Math.min(innerWidth,visible.right);
      visible.top=Math.max(0,visible.top);visible.bottom=Math.min(innerHeight,visible.bottom);
      return {...visible,width:visible.right-visible.left,height:visible.bottom-visible.top,raw};
    };
    const part=(node,label)=>shown(node)?{label,...rect(node)}:null;
    const parts=(root,selectors)=>selectors.map(selector=>part(root.querySelector(selector),selector)).filter(Boolean);
    const players=[...document.querySelectorAll('.opponents .player')].map(node=>({id:node.dataset.player,rect:rect(node),
      parts:parts(node,['.avatar','.seat-name','.prediction','.lead-badge','.turn-label']),
      prediction:[...node.querySelectorAll('.prediction > span')].map(node=>parts(node,['small','b'])),
      predictionItems:[...node.querySelectorAll('.prediction > span')].filter(shown).map(node=>rect(node)),
      fullName:node.getAttribute('aria-label')}));
    const own=document.querySelector('.own-status');
    const ownParts=own?parts(own,[':scope > .avatar',':scope > .own-name',':scope > .own-metrics',':scope > .own-action']):[];
    const metrics=own?[...own.querySelectorAll('.own-metrics > span')].filter(shown).map(node=>part(node,node.textContent)):[];
    const ownAction=own?.querySelector('.own-action');
    const ownActionParts=ownAction?[...ownAction.children].filter(shown).map(node=>part(node,node.id||'action-copy')):[];
    const controls=[...document.querySelectorAll('.game-toolbar > button,#chat-toggle,#confirm-play,.bid-options,.settlement-actions')].filter(shown).map(node=>{
      const r=rect(node);return {label:node.id||node.className,...r,hit:node.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2))};
    });
    const status=[...document.querySelectorAll('.roundbar,.action-title h3,.lead-callout,.own-action > span,#turn-countdown')].filter(shown).map(node=>part(node,node.className||node.id));
    const scene=window.__mobileReview.scene,canvas=scene.renderer.domElement.getBoundingClientRect();
    const projected=mesh=>{
      mesh.updateWorldMatrix(true,false);mesh.geometry.computeBoundingBox();const box=mesh.geometry.boundingBox,points=[];
      for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z]) {
        const p=mesh.position.clone().set(x,y,z).applyMatrix4(mesh.matrixWorld).project(scene.camera);
        points.push({x:canvas.left+(p.x+1)*canvas.width/2,y:canvas.top+(1-p.y)*canvas.height/2});
      }
      return {left:Math.min(...points.map(p=>p.x)),right:Math.max(...points.map(p=>p.x)),top:Math.min(...points.map(p=>p.y)),bottom:Math.max(...points.map(p=>p.y))};
    };
    const publicCards=[...scene.cards.entries()].filter(([,group])=>group.visible).map(([id,group])=>({id,...projected(group.userData.edge)}));
    const trump=[...document.querySelectorAll('.table-trump')].filter(shown).map(node=>rect(node));
    if(scene.trump.visible)trump.push(projected(scene.trumpFace));
    return {width:innerWidth,height:innerHeight,phase:window.__mobileReview.state.phase,mode:document.body.dataset.tableLayout,
      ownTurn:window.__mobileReview.state.players[window.__mobileReview.state.turn]?.id==='p0',
      overflow:document.documentElement.scrollWidth>innerWidth,scrollY,players,own:own?rect(own):null,ownParts,ownActionParts,metrics,controls,status,
      publicCards,trump,
      hand:[...document.querySelectorAll('.hand .card')].filter(shown).map(node=>clippedRect(node)).filter(r=>r.width>0&&r.height>0)};
  });
}

function verify(data) {
  const label=`${data.width}x${data.height} ${data.phase}`;
  expect(data.overflow,`${label}: horizontal overflow`).toBe(false);expect(data.scrollY).toBe(0);
  const inside=(r,name)=>{
    expect(r.left,`${label}: ${name} left`).toBeGreaterThanOrEqual(-1);expect(r.top,`${label}: ${name} top`).toBeGreaterThanOrEqual(-1);
    expect(r.right,`${label}: ${name} right`).toBeLessThanOrEqual(data.width+1);expect(r.bottom,`${label}: ${name} bottom`).toBeLessThanOrEqual(data.height+1);
  };
  for(const player of data.players) {
    inside(player.rect,player.id);
    for(const part of player.parts)inside(part,`${player.id} ${part.label}`);
    expect(player.fullName).toContain('预测');
    for(const a of player.parts)for(const b of player.parts) {
      if(a===b||a.label==='.lead-badge'&&b.label==='.avatar'||a.label==='.avatar'&&b.label==='.lead-badge') continue;
      expect(overlap(a,b),`${label}: ${player.id} ${a.label} overlaps ${b.label}`).toBe(false);
    }
    expect(player.parts.some(part=>part.label==='.prediction'),`${label}: ${player.id} win and prediction stay visible`).toBe(true);
    for(const pair of player.prediction) if(pair.length===2)expect(overlap(...pair),`${label}: ${player.id} win/prediction text`).toBe(false);
    for(const a of player.predictionItems)for(const b of player.predictionItems)if(a!==b)expect(overlap(a,b),`${label}: ${player.id} win/estimate groups`).toBe(false);
    for(const other of data.players) if(player!==other)expect(overlap(player.rect,other.rect),`${label}: ${player.id}/${other.id}`).toBe(false);
    for(const control of data.controls)expect(overlap(player.rect,control),`${label}: ${player.id} overlaps ${control.label}`).toBe(false);
    const roundbar=data.status.find(part=>part.label==='roundbar');
    if(roundbar)expect(overlap(player.rect,roundbar),`${label}: ${player.id} overlaps round header`).toBe(false);
  }
  for(const a of data.ownParts)for(const b of data.ownParts) if(a!==b)expect(overlap(a,b),`${label}: own ${a.label}/${b.label}`).toBe(false);
  for(const a of data.metrics)for(const b of data.metrics)if(a!==b)expect(overlap(a,b),`${label}: own metrics`).toBe(false);
  for(const a of data.ownActionParts)for(const b of data.ownActionParts)if(a!==b)expect(overlap(a,b),`${label}: own prompt and countdown`).toBe(false);
  for(const control of data.controls) {
    inside(control,control.label);expect(control.hit,`${label}: ${control.label} reachable`).toBe(true);
    if(data.own)expect(overlap(data.own,control),`${label}: own area overlaps ${control.label}`).toBe(false);
  }
  if(data.phase==='play') {
    expect(data.hand.length).toBeGreaterThan(0);
    const confirm=data.controls.find(control=>control.label==='confirm-play');
    if(data.ownTurn) {
      expect(confirm).toBeTruthy();
      for(const card of data.hand)expect(overlap(confirm,card),`${label}: play button overlaps card`).toBe(false);
    } else expect(confirm,'other players act without an own play button').toBeUndefined();
  }
  if(data.own)for(const card of data.hand)expect(overlap(data.own,card),`${label}: own information overlaps hand`).toBe(false);
  for(const card of data.publicCards) {
    inside(card,`public ${card.id}`);
    for(const obstacle of [...data.controls,...data.players.map(player=>player.rect),...data.trump,...(data.own?[data.own]:[])])
      expect(overlap(card,obstacle),`${label}: public ${card.id} overlaps player, operation or trump ${obstacle.label||JSON.stringify(obstacle)}`).toBe(false);
    for(const other of data.publicCards)if(card!==other)expect(overlap(card,other),`${label}: public cards overlap`).toBe(false);
  }
}

function verifyOwnAction(data) {
  expect(data.ownActionParts).toHaveLength(2);
  for(const part of data.ownActionParts) {
    expect(part.left,'prompt/countdown stays inside own area').toBeGreaterThanOrEqual(data.own.left-1);
    expect(part.right,'prompt/countdown stays inside own area').toBeLessThanOrEqual(data.own.right+1);
    expect(part.top).toBeGreaterThanOrEqual(data.own.top-1);expect(part.bottom).toBeLessThanOrEqual(data.own.bottom+1);
    expect(part.left).toBeGreaterThanOrEqual(0);expect(part.right).toBeLessThanOrEqual(data.width);
    expect(part.top).toBeGreaterThanOrEqual(0);expect(part.bottom).toBeLessThanOrEqual(data.height);
  }
  expect(overlap(...data.ownActionParts),'long name stays separate from countdown').toBe(false);
}

async function outside(page) {
  const point=await page.evaluate(()=>{
    const excluded='#table-menu-panel,#table-score-panel,#room-chat,#rename-panel,.settlement-details-body,.game-toolbar,button,input,summary,[role="button"],.trump-display,.own-status,.opponents .player';
    const avoid=[...document.querySelectorAll(excluded)].filter(node=>node.checkVisibility()).map(node=>node.getBoundingClientRect());
    for(const clearance of [12,0])for(let y=8;y<innerHeight-8;y+=17)for(let x=4;x<innerWidth-4;x+=17) {
      const node=document.elementFromPoint(x,y);
      // A finger tap close to a panel edge may be adjusted onto a nearby button.
      // Wide score sheets can leave only a thin margin; check that margin with
      // a mouse, and exercise touch dismissal whenever actual space permits.
      if(node&&!node.closest(excluded)&&node.closest('.table')&&!avoid.some(r=>x>r.left-clearance&&x<r.right+clearance&&y>r.top-clearance&&y<r.bottom+clearance))return {x,y,touch:clearance>0};
    }
    throw Error('No blank table location');
  });
  if(page.viewportSize().width<1000&&point.touch)await page.touchscreen.tap(point.x,point.y);
  else await page.mouse.click(point.x,point.y);
}

async function interactions(page) {
  const menu=page.locator('#table-menu-panel'),scores=page.locator('#table-score-panel'),chat=page.locator('#room-chat');
  const menuTrigger=page.locator('#table-menu'),scoreTrigger=page.locator('#table-scores');
  await menuTrigger.click();await expect(menu).toBeVisible();
  await menu.locator('.current-rules').click();await expect(menu).toBeVisible();
  await menuTrigger.click();await expect(menu).toBeHidden();
  await menuTrigger.click();await outside(page);await expect(menu).toBeHidden();
  await menuTrigger.click();await page.keyboard.press('Escape');await expect(menu).toBeHidden();
  await scoreTrigger.click();await expect(scores).toBeVisible();
  await scores.locator('.section-label').first().click();await expect(scores).toBeVisible();
  await scoreTrigger.click();await expect(scores).toBeHidden();
  const avatars=page.locator('.opponents [data-player-details]');
  await avatars.first().click();await expect(scores).toBeVisible();
  await avatars.first().click();await expect(scores).toBeHidden();
  await avatars.first().click();
  const secondId=await avatars.evaluateAll(nodes=>nodes.slice(1).find(node=>{
    const r=node.getBoundingClientRect();return node.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2));
  })?.dataset.playerDetails);
  expect(secondId,'a second visible avatar can switch the open score sheet').toBeTruthy();
  await page.locator(`[data-player-details="${secondId}"]`).click();await expect(scores).toBeVisible();
  await menuTrigger.click();await expect(menu).toBeVisible();await expect(scores).toBeHidden();
  await page.locator('#chat-toggle').click();await expect(chat).toBeVisible();await expect(menu).toBeHidden();
  await page.locator('#chat-input').fill('保留输入');await expect(chat).toBeVisible();
  await outside(page);await expect(chat).toBeHidden();
  await page.locator('#chat-toggle').click();await expect(page.locator('#chat-input')).toHaveValue('保留输入');
  await page.locator('#chat-form button').click();await expect(page.locator('#chat-messages')).toContainText('保留输入');
  await expect(page.locator('#chat-input')).toHaveValue('');
  await page.keyboard.press('Escape');await expect(chat).toBeHidden();
  await menuTrigger.click();await page.locator('#rename-toggle').click();await expect(page.locator('#rename-panel')).toBeVisible();await expect(menu).toBeHidden();
  await page.locator('#rename-input').fill('临时昵称');await expect(page.locator('#rename-panel')).toBeVisible();
  await outside(page);await expect(page.locator('#rename-panel')).toBeHidden();
  await menuTrigger.click();await scoreTrigger.click();await expect(menu).toBeHidden();await expect(scores).toBeVisible();
  await outside(page);await expect(scores).toBeHidden();
  let confirmations=0;
  page.once('dialog',async dialog=>{confirmations++;expect(dialog.message()).toContain('确定解散房间');await dialog.dismiss();});
  await menuTrigger.click();await page.locator('#room-dissolve').click();expect(confirmations).toBe(1);await expect(page.locator('.table')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.locator('#room-pause').click();await expect(page.locator('#room-pause')).toHaveAttribute('aria-label','恢复牌局');
  await page.locator('#room-pause').click();await expect(page.locator('#room-pause')).toHaveAttribute('aria-label','暂停牌局');
  const card=await page.locator('.hand .playable').evaluateAll(nodes=>{
    for(const node of nodes) {
      const r=node.getBoundingClientRect();
      for(const fx of [.2,.5,.8])for(const fy of [.5,.75]) {
        const x=r.left+r.width*fx,y=r.top+r.height*fy;
        if(node.contains(document.elementFromPoint(x,y)))return {x,y,id:node.dataset.card};
      }
    }
    throw Error('No reachable legal hand card');
  });
  await page.mouse.click(card.x,card.y);await expect(page.locator('.hand .selected')).toHaveAttribute('data-card',card.id);
  await menuTrigger.click();await menu.locator('.current-rules').click();
  await page.locator('#hand-sort').click();await expect(menu).toBeVisible();
  await expect(page.locator('.hand .selected')).toHaveAttribute('data-card',card.id);
  await page.keyboard.press('Escape');await page.locator('#confirm-play').click();
  await expect(page.locator(`.hand [data-card="${card.id}"]`)).toHaveCount(0);
  expect(await page.evaluate(id=>window.__mobileReview.game.events.filter(event=>event.type==='play'&&event.card?.id===id).length,card.id)).toBe(1);
  await expect(page.locator('.own-action b')).toContainText('等待');
  verifyOwnAction(await geometry(page));
  return {outside:true,inside:true,repeat:true,escape:true,switching:true,chatDraft:true,chatSend:true,confirmationDismissed:true,pauseResume:true,selectedCardRetained:true,handSort:true,singlePlay:true,waitingLongName:true};
}

async function settingsInteractions() {
  const context=await browser.newContext({viewport:{width:320,height:568},hasTouch:true,reducedMotion:'reduce'});
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  await page.goto(base);await page.locator('#nickname').fill('本地测试');await page.locator('#practice').click();
  const settings=page.locator('#quick-settings'),summary=settings.locator('summary'),content=settings.locator('.settings-content');
  await summary.click();await expect(content).toBeVisible();
  await page.locator('#trump-motion').click();await expect(content).toBeVisible();
  await summary.click();await expect(content).toBeHidden();
  await summary.click();await page.locator('.lobby-controls .start-hint').click();await expect(content).toBeHidden();
  await summary.click();await page.keyboard.press('Escape');await expect(content).toBeHidden();
  await summary.click();await page.locator('#rename-toggle').click();await expect(content).toBeHidden();
  await expect(page.locator('#rename-panel')).toBeVisible();await page.keyboard.press('Escape');
  await summary.click();await page.locator('#chat-toggle').click();await expect(content).toBeHidden();
  await expect(page.locator('#room-chat')).toBeVisible();await page.keyboard.press('Escape');
  await summary.click();await page.locator('#rules').click();await expect(page.locator('.modal')).toBeVisible();
  await page.locator('.modal p').first().click();await expect(page.locator('.modal')).toBeVisible();
  await page.keyboard.press('Escape');await expect(page.locator('.modal')).toHaveCount(0);
  await context.close();return {outside:true,inside:true,repeat:true,escape:true,switching:true,rulesModal:true};
}

async function settlementInteractions(page) {
  const details=page.locator('.settlement-details'),summary=details.locator('summary'),body=details.locator('.settlement-details-body');
  await summary.click();await expect(body).toBeVisible();
  await body.locator('.settlement-formula').click();await expect(body).toBeVisible();
  await summary.click();await expect(body).toBeHidden();
  await summary.click();await outside(page);await expect(body).toBeHidden();
  await summary.click();await page.keyboard.press('Escape');await expect(body).toBeHidden();
  await summary.click();await page.locator('#table-menu').click();await expect(body).toBeHidden();await expect(page.locator('#table-menu-panel')).toBeVisible();
  await page.keyboard.press('Escape');
  return {outside:true,inside:true,repeat:true,escape:true,switching:true};
}

async function expandedHand(page) {
  const initial=await geometry(page);
  await page.locator('#table-menu').click();await page.locator('#hand-expand').click();
  await expect(page.locator('#table-menu-panel')).toBeVisible();await page.locator('#table-menu').click();
  await expect(page.locator('.hand-section.expanded .hand-grid')).toBeVisible();await page.waitForTimeout(160);
  const expanded=await geometry(page);
  fs.writeFileSync(`${out}/${stamp}-expanded-${expanded.width}x${expanded.height}.json`,JSON.stringify(expanded,null,2));
  await page.screenshot({path:`${out}/${stamp}-expanded-${expanded.width}x${expanded.height}.png`});verify(expanded);
  expect(Math.max(...expanded.hand.map(card=>card.height)),'expanded hand retains a usable card viewing area').toBeGreaterThanOrEqual(44);
  await page.locator('#table-menu').click();await page.locator('#hand-expand').click();await page.locator('#table-menu').click();
  await page.waitForTimeout(100);const collapsed=await geometry(page);verify(collapsed);
  for(const card of initial.publicCards) {
    const restored=collapsed.publicCards.find(other=>other.id===card.id);expect(restored).toBeTruthy();
    for(const edge of ['left','right','top','bottom'])expect(Math.abs(restored[edge]-card[edge]),'collapsing the grid restores the public destinations').toBeLessThanOrEqual(1);
  }
  return {visible:true,controlsClear:true,publicCardsClear:true,collapseRestores:true};
}

async function finalRanking(page) {
  const result=await page.locator('.final-results').evaluate(node=>{
    node.scrollTop=node.scrollHeight;node.scrollLeft=node.scrollWidth;
    const r=node.getBoundingClientRect(),last=node.querySelector('tbody tr:last-child'),total=last.querySelector('.final-total'),row=last.getBoundingClientRect(),cell=total.getBoundingClientRect();
    return {rows:node.querySelectorAll('tbody tr').length,scrollHeight:node.scrollHeight,clientHeight:node.clientHeight,
      lastRowVisible:row.top>=r.top-1&&row.bottom<=r.bottom+1,lastTotalVisible:cell.left>=r.left-1&&cell.right<=r.right+1};
  });
  expect(result.rows).toBe(6);expect(result.lastRowVisible,'last ranked player is reachable by scrolling').toBe(true);
  expect(result.lastTotalVisible,'rightmost final total is reachable by scrolling').toBe(true);return result;
}

async function rotationReview() {
  const {context,page}=await open(fixture(6,'bid',8),390,844),rotations=[];
  for(const [width,height] of [[390,844],[844,300],[390,844]]) {
    await page.setViewportSize({width,height});
    await page.waitForFunction(()=>{
      const panel=document.querySelector('.action-panel');
      return Math.abs(panel.getBoundingClientRect().height-parseFloat(getComputedStyle(document.body).getPropertyValue('--action-panel-height')))<1;
    });
    await page.waitForTimeout(100);const data=await geometry(page);verify(data);
    const metrics=await page.evaluate(()=>({actual:document.querySelector('.action-panel').getBoundingClientRect().height,
      reserved:parseFloat(getComputedStyle(document.body).getPropertyValue('--action-panel-height'))}));
    expect(Math.abs(metrics.actual-metrics.reserved),'rotated prediction panel reserves its current height').toBeLessThan(1);
    rotations.push({width,height,mode:data.mode,...metrics});
  }
  await context.close();return rotations;
}

async function opponentLeader(width,height) {
  const record=fixture(6,'play',3,{ownTurn:false,emptyTrick:true}),active=record.game.players[record.game.turn].id;
  expect(leadInfo(record.game).seat).toBe(record.game.turn);
  const {context,page}=await open(record,width,height),data=await geometry(page);
  fs.writeFileSync(`${out}/${stamp}-${width}x${height}-6-opponent-leader.json`,JSON.stringify(data,null,2));
  await page.screenshot({path:`${out}/${stamp}-${width}x${height}-6-opponent-leader.png`});verify(data);verifyOwnAction(data);
  const parts=data.players.find(player=>player.id===active).parts;
  expect(parts.some(part=>part.label==='.lead-badge')).toBe(true);
  expect(parts.some(part=>part.label==='.turn-label'),'active leader has a separate turn prompt').toBe(true);
  await expect(page.locator('.own-action b')).toContainText('等待');
  await context.close();return {width,height,players:6,activeLeader:true,separateTurnLabel:true,waitingPrompt:true};
}

try {
  const cases=[[320,568,6,'bid'],[320,568,6,'play'],[320,568,6,'roundEnd'],[320,568,6,'finished'],
    [360,640,5,'play'],[390,844,4,'bid'],[390,844,3,'play'],[568,320,6,'play'],[844,300,6,'play'],
    [844,300,6,'finished'],[768,1024,6,'bid',8],[768,1024,6,'play',8],[1440,900,6,'play']];
  for(const [width,height,count,phase,round] of cases) {
    if(process.env.REVIEW_VIEWPORT&&process.env.REVIEW_VIEWPORT!==`${width}x${height}`)continue;
    if(process.env.REVIEW_PHASE&&process.env.REVIEW_PHASE!==phase)continue;
    const {context,page}=await open(fixture(count,phase,round),width,height);
    const data=await geometry(page);fs.writeFileSync(`${out}/${stamp}-${width}x${height}-${count}-${phase}.json`,JSON.stringify(data,null,2));
    await page.screenshot({path:`${out}/${stamp}-${width}x${height}-${count}-${phase}.png`});
    let floating=null,settlement=null,expanded=null,ranking=null;
    let verified=false;
    try {
      if(!baseline)verify(data);
      verified=!baseline;
      if(!baseline&&phase==='play'&&[320,568,844].includes(width))expanded=await expandedHand(page);
      if(!baseline&&phase==='play'&&[320,1440].includes(width))floating=await interactions(page);
      if(!baseline&&phase==='roundEnd')settlement=await settlementInteractions(page);
      if(!baseline&&phase==='finished')ranking=await finalRanking(page);
    } catch(error) {
      if(process.env.REVIEW_COLLECT!=='true')throw error;
      failures.push({width,height,count,phase,error:error.message});
    }
    checks.push({width,height,count,phase,mode:data.mode,geometry:verified,floating,settlement,expanded,ranking});
    await context.close();
  }
  if(!baseline&&!process.env.REVIEW_VIEWPORT&&!process.env.REVIEW_PHASE) {
    checks.push({lobbySettings:await settingsInteractions()});checks.push({rotation:await rotationReview()});
    for(const [width,height] of [[320,568],[844,390]])checks.push({opponentLeader:await opponentLeader(width,height)});
  }
  if(!baseline&&process.env.REVIEW_PHASE==='rotation')checks.push({rotation:await rotationReview()});
  console.log(JSON.stringify({checks,errors,failures},null,2));expect(errors).toEqual([]);expect(failures).toEqual([]);
} catch(error) {
  for(const context of browser.contexts())for(const page of context.pages())if(!page.isClosed())await page.screenshot({path:`${out}/${stamp}-failure.png`}).catch(()=>{});
  throw error;
} finally {
  fs.writeFileSync(`${out}/${stamp}-review.json`,JSON.stringify({checks,errors,failures},null,2));await browser.close();
}
