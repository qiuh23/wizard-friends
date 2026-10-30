import { chromium, expect } from '@playwright/test';
import fs from 'node:fs';
import { createGame, addPlayer, act, viewFor } from '../src/game.js';
import { createRandomStream } from '../src/random.js';
import { DEFAULT_OPTIONS } from '../src/rules-options.js';

// Local review only. Use the same browser, viewport and quality for both refs.
// Inspection hooks are appended to browser responses, never to product APIs.
const base = process.env.GAME_URL || 'http://127.0.0.1:5191/';
const stage = process.env.PERF_STAGE || 'after';
const stamp = process.env.REVIEW_STAMP || '20261030-render-scheduling';
const out = 'output/playwright'; fs.mkdirSync(out, { recursive:true });
const checks = [], extendedChecks = [], errors = [];
const measurement = {
  layout:'updateLayoutMetrics calls, including checks that reuse cached geometry',
  layoutMs:'time spent inside updateLayoutMetrics, including browser layout work',
  addedRemoved:'MutationObserver direct added/removed nodes, not total descendants',
  elapsedMs:'observation window including interaction and explicit settling; not interaction latency',
  idle:'idle counters begin after prior UI layout work settles',
};
const strict = stage !== 'baseline';
const browser = await chromium.launch({channel:process.env.BROWSER_CHANNEL || 'chrome',headless:true});

function fixture(phase='play',round=8,count=6) {
  const game=createGame(); game.randomState=createRandomStream(Array(11).fill(5));
  for(let i=0;i<count;i++) addPlayer(game,`p${i}`,['青岚','云舒','风行','竹影','星河','雨晴'][i]);
  act(game,'p0',{type:'start',options:{...DEFAULT_OPTIONS,short:false}});
  for(let step=0;step<20000;step++) {
    if(game.round===round && game.phase===phase && (phase!=='play'||game.turn===0)) {
      return {version:1,role:'practice',room:'离线练习',me:'p0',game,identities:{}};
    }
    const id=game.players[game.turn].id,view=viewFor(game,id);
    if(game.phase==='trump') act(game,id,{type:'trump',suit:'blue'});
    else if(game.phase==='bid') act(game,id,{type:'bid',value:view.bids[0]});
    else if(game.phase==='play') act(game,id,{type:'play',card:view.legal[0]});
    else if(['trickEnd','roundEnd'].includes(game.phase)) act(game,'p0',{type:'next'});
    else throw Error(`Unexpected fixture phase ${game.phase}`);
  }
  throw Error(`Fixture not reached: ${phase}`);
}

async function open(width,height,{webgl=true,reduced=false,record=fixture(),holdImages=false}={}) {
  const context=await browser.newContext({viewport:{width,height},hasTouch:width<851,reducedMotion:reduced?'reduce':'no-preference'});
  await context.addInitScript(({record,webgl})=>{
    record.game.turnDeadline=Date.now()+600000;
    sessionStorage.setItem('wizard-room-session',JSON.stringify(record));
    localStorage.setItem('wizard-low-graphics','true');
    localStorage.setItem('wizard-trump-motion','true');
    localStorage.setItem('wizard-turn-sound','false');
    if(!webgl) {
      const original=HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext=function(kind,...args){return kind.startsWith('webgl')?null:original.call(this,kind,...args);};
    }
  },{record,webgl});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  let imagesReleased=!holdImages;const pendingImages=[];
  if(holdImages)await page.route(/\.svg(?:\?|$)/,route=>{
    if(route.request().resourceType()!=='image'||imagesReleased)return route.continue();
    pendingImages.push(route);
  });
  await page.route(/\/src\/main\.js(?:\?|$)/,async route=>{
    const response=await route.fetch();
    await route.fulfill({response,body:await response.text()+`
      {
        let counts={render:0,layout:0,layoutMs:0,drawHTML:0,attach:0,resize:0,webgl:0,childList:0,added:0,removed:0,tableChildren:0,handChildren:0,style:0};
        const selectors=['.table','.opponents','.hand-section','.hand','.own-status','.action-panel','#table-score-panel','#chat-input'];
        let refs={}, observer;
        const originalRender=render;render=function(...args){counts.render++;return originalRender(...args);};
        const originalLayout=updateLayoutMetrics;updateLayoutMetrics=function(...args){counts.layout++;const start=performance.now();try{return originalLayout(...args);}finally{counts.layoutMs+=performance.now()-start;}};
        const originalHTML=drawHTMLCards;drawHTMLCards=function(...args){counts.drawHTML++;return originalHTML(...args);};
        window.__renderReview={
          get state(){return state;},get game(){return game;},get scene(){return tableScene;},get selected(){return selectedCard;},
          get motion(){return tableMotion;},get reveal(){return trumpReveal;},
          clearNotice(){notify('');}, redraw(){render();},
          reset(){
            counts=Object.fromEntries(Object.keys(counts).map(key=>[key,0]));
            refs=Object.fromEntries(selectors.map(selector=>[selector,document.querySelector(selector)]));
            observer?.disconnect();observer=new MutationObserver(records=>{
              for(const record of records){
                if(record.type==='attributes'){if(record.attributeName==='style')counts.style++;continue;}
                counts.childList++;counts.added+=record.addedNodes.length;counts.removed+=record.removedNodes.length;
                if(record.target.closest?.('.table')||[...record.removedNodes].some(node=>node===refs['.table']||node.contains?.(refs['.table'])))counts.tableChildren++;
                if(record.target.closest?.('.hand-section'))counts.handChildren++;
              }
            });observer.observe(document.querySelector('#app'),{childList:true,subtree:true,attributes:true,attributeFilter:['style']});
            if(tableScene && !tableScene.__counted){
              tableScene.__counted=true;
              for(const name of ['attach','resize']) {const original=tableScene[name];tableScene[name]=function(...args){counts[name]++;return original.apply(this,args);};}
              const original=tableScene.renderer.render;tableScene.renderer.render=function(...args){counts.webgl++;return original.apply(this,args);};
            }
          },
          read(){return {...counts,stable:Object.fromEntries(selectors.map(selector=>[selector,refs[selector]===document.querySelector(selector)])),selected:selectedCard,handScroll:document.querySelector('.hand')?.scrollLeft,focus:document.activeElement?.id||document.activeElement?.dataset.card||document.activeElement?.tagName};},
          apply(next,{paused=false,initial=true}={}) {
            clearTimeout(turnTimer);clearTimeout(botTimer);game=next;me='p0';
            game.turnDeadline=Date.now()+600000;practice=true;isHost=true;spectating=false;networkReady=true;
            practicePaused=paused;practiceRemaining=600000;
            state=viewFor(game,me);state.lifecycle={...(next.lifecycle||{}),paused,remainingMs:600000};
            updateEventEffects(initial);render();
          }
        };
      }`});
  });
  await page.goto(base,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!!window.__renderReview&&!!document.querySelector('.table'));
  if(webgl) await page.waitForFunction(()=>document.body.classList.contains('has-webgl'));
  await page.evaluate(()=>window.__renderReview.clearNotice());
  await page.waitForTimeout(700);
  return {context,page,releaseImages:async()=>{imagesReleased=true;await Promise.all(pendingImages.splice(0).map(route=>route.continue()));}};
}

async function measure(page,name,action,{stable=false,settle=160}={}) {
  await page.evaluate(()=>window.__renderReview.reset());
  const started=performance.now();
  await action();if(settle)await page.waitForTimeout(settle);
  const result={name,elapsedMs:performance.now()-started,...await page.evaluate(()=>window.__renderReview.read())};
  if(strict&&stable) for(const selector of ['.table','.opponents','.hand-section','.hand','.own-status','.action-panel','#table-score-panel','#chat-input']) {
    expect(result.stable[selector],`${name} preserves ${selector}`).toBe(true);
  }
  return result;
}

async function selectLegal(page) {
  const point=await page.locator('.hand').evaluate(hand=>{
    for(const node of hand.querySelectorAll('[data-card]:not(.illegal)')) {
      const r=node.getBoundingClientRect();
      for(const fx of [.15,.5,.85]) for(const fy of [.45,.65,.85]) {
        const x=r.left+r.width*fx,y=r.top+r.height*fy;
        if(x>0&&x<innerWidth&&y>0&&y<innerHeight&&node.contains(document.elementFromPoint(x,y)))return {x,y,id:node.dataset.card};
      }
    }
    throw Error('No unobscured legal hand card');
  });
  await page.mouse.click(point.x,point.y);await expect(page.locator('.hand .selected')).toHaveAttribute('data-card',point.id);
  return point.id;
}

async function blank(page) {
  const point=await page.locator('.table').evaluate(table=>{
    const r=table.getBoundingClientRect();
    for(let y=r.top+80;y<r.bottom-100;y+=20)for(let x=r.left+12;x<r.right-12;x+=20){
      const node=document.elementFromPoint(x,y);
      if(node&&table.contains(node)&&node.matches('.table,.table-ring,.scene-host,canvas,.played-cards'))return {x,y};
    }
    throw Error('No blank surface point');
  });
  await page.mouse.click(point.x,point.y);
}

try {
  const viewports=process.env.REVIEW_EXTENDED==='only'?[]:[[1440,900],[390,844],[844,300]].filter(([w,h])=>!process.env.REVIEW_VIEWPORT||process.env.REVIEW_VIEWPORT===w+'x'+h);
  for(const [width,height]of viewports)for(const mode of [{webgl:true,reduced:false},{webgl:true,reduced:true},{webgl:false,reduced:true}]){
    const {context,page}=await open(width,height,mode),operations=[];
    const imageName=`${stage}-${width}x${height}-${mode.webgl?'3d':'2d'}-${mode.reduced?'reduced':'motion'}-${stamp}`;
    const authoritative=await page.evaluate(()=>JSON.stringify({random:window.__renderReview.game.randomState,seq:window.__renderReview.game.eventSeq,turn:window.__renderReview.game.turn,trick:window.__renderReview.game.trick}));
    let selected;
    operations.push(await measure(page,'select',async()=>{selected=await selectLegal(page);},{stable:true}));
    await page.waitForTimeout(100);await page.screenshot({path:`${out}/render-selected-${imageName}.png`});
    operations.push(await measure(page,'cancel',async()=>{await blank(page);await expect(page.locator('.hand .selected')).toHaveCount(0);},{stable:true}));
    await selectLegal(page);selected=await page.evaluate(()=>window.__renderReview.selected);
    operations.push(await measure(page,'menu-open',()=>page.locator('#table-menu').click(),{stable:true}));
    operations.push(await measure(page,'sort',async()=>{await page.locator('#hand-sort').click();await expect(page.locator('.hand .selected')).toHaveAttribute('data-card',selected);},{stable:true}));
    const scroll=await page.evaluate(id=>{
      const hand=document.querySelector('.hand');hand.querySelector('[data-card="'+id+'"]').focus({preventScroll:true});
      hand.scrollLeft=(hand.scrollWidth-hand.clientWidth)/2;return hand.scrollLeft;
    },selected);
    const retained=await measure(page,'sort-retains-focus-scroll',()=>page.evaluate(()=>document.querySelector('#hand-sort').click()),{stable:true});
    retained.focusRetained=await page.locator('.hand [data-card="'+selected+'"]').evaluate(node=>node===document.activeElement);
    retained.scrollRetained=Math.abs(retained.handScroll-scroll)<=1;
    if(strict){expect(retained.focusRetained).toBe(true);expect(retained.scrollRetained).toBe(true);}
    operations.push(retained);
    operations.push(await measure(page,'expand',async()=>{await page.locator('#hand-expand').click();await expect(page.locator('.hand-grid')).toBeVisible();},{stable:true}));
    await page.waitForTimeout(100);await page.screenshot({path:`${out}/render-expanded-${imageName}.png`});
    operations.push(await measure(page,'shrink',()=>page.locator('#hand-expand').click(),{stable:true}));
    if(await page.locator('#hand-collapse').isVisible()) {
      operations.push(await measure(page,'collapse',()=>page.locator('#hand-collapse').click(),{stable:true}));
      operations.push(await measure(page,'uncollapse',()=>page.locator('#hand-collapse').click(),{stable:true}));
    }
    await page.locator('#table-menu').click();
    expect(await page.evaluate(()=>JSON.stringify({random:window.__renderReview.game.randomState,seq:window.__renderReview.game.eventSeq,turn:window.__renderReview.game.turn,trick:window.__renderReview.game.trick})), 'UI-only operations preserve rule state and random stream').toBe(authoritative);
    const before=await page.evaluate(id=>window.__renderReview.game.events.filter(e=>e.type==='play'&&e.card?.id===id).length,selected);
    operations.push(await measure(page,'confirm',async()=>{await page.locator('#confirm-play').click();await expect(page.locator('.hand [data-card="'+selected+'"]')).toHaveCount(0);}));
    const submitted=await page.evaluate(id=>window.__renderReview.game.events.filter(e=>e.type==='play'&&e.card?.id===id).length,selected);
    expect(submitted).toBe(before+1);
    // A programmatic state redraw models receipt of an unchanged view while typing.
    await page.evaluate(()=>window.__renderReview.redraw());
    await page.locator('#chat-toggle').click();await page.locator('#chat-input').fill('保留草稿与焦点');
    operations.push(await measure(page,'state-redraw-with-draft',()=>page.evaluate(()=>window.__renderReview.redraw())));
    await expect(page.locator('#chat-input')).toHaveValue('保留草稿与焦点');
    await expect(page.locator('#chat-input')).toBeFocused();
    await page.locator('#close-chat').click();
    // Closing chat legitimately queues layout/draw work; sample after it settles.
    await page.waitForTimeout(300);
    const idle=[];
    idle.push(await measure(page,'normal-idle-1000ms',()=>page.waitForTimeout(1000),{settle:0}));
    await page.evaluate(record=>window.__renderReview.apply(record.game,{paused:true}),fixture('trickEnd'));
    await page.waitForTimeout(300);
    idle.push(await measure(page,'paused-idle-1000ms',()=>page.waitForTimeout(1000),{settle:0}));
    if(strict){
      expect(idle.at(-1).webgl,'paused WebGL submits no idle frames').toBe(0);
      expect(idle.at(-1).drawHTML,'paused HTML stops querying settled cards').toBe(0);
    }
    if(strict&&mode.reduced){
      expect(idle[0].webgl,'reduced-motion WebGL submits no idle frames').toBe(0);
      expect(idle[0].drawHTML,'reduced-motion HTML stops querying settled cards').toBe(0);
    }
    checks.push({width,height,...mode,operations,idle,singleSubmission:true,draftFocus:true});
    console.log(JSON.stringify({stage,width,height,...mode,operations:operations.map(({name,render,layout,attach,resize,webgl,added,removed,stable})=>({name,render,layout,attach,resize,webgl,added,removed,stable})),idle}));
    await context.close();
  }
  if(strict&&process.env.REVIEW_EXTENDED)await reviewExtended();
  expect(errors).toEqual([]);
} finally {
  fs.writeFileSync(`${out}/render-scheduling-${stage}${process.env.REVIEW_EXTENDED==='only'?'-extended':''}-${stamp}.json`,JSON.stringify({stage,base,browser:process.env.BROWSER_CHANNEL||'chrome',quality:'low',measurement,checks,extendedChecks,errors},null,2));
  await browser.close();
}

async function reviewExtended() {
  for(const [width,height]of [[1440,900],[390,844],[844,300]]) {
    const {context,page}=await open(width,height,{record:fixture('play',20,3)});
    const count=await page.locator('.hand [data-card]').count();expect(count).toBeGreaterThanOrEqual(19);
    const id=await selectLegal(page);
    await page.locator('#table-menu').click();await page.locator('#hand-sort').click();
    await expect(page.locator('.hand .selected')).toHaveAttribute('data-card',id);
    await page.locator('#hand-expand').click();await expect(page.locator('.hand-grid')).toBeVisible();
    const reach=await page.locator('.hand').evaluate(hand=>{hand.scrollTop=hand.scrollHeight;return {top:hand.scrollTop,max:hand.scrollHeight-hand.clientHeight};});
    expect(reach.top).toBeCloseTo(reach.max,0);
    await page.screenshot({path:`${out}/render-20-cards-${width}x${height}-${stamp}.png`});
    await page.locator('#hand-expand').click();await page.locator('#table-menu').click();
    await page.setViewportSize(width===1440?{width:390,height:844}:width===390?{width:844,height:300}:{width:1440,height:900});
    await page.waitForTimeout(300);
    const handMode=await page.locator('.hand').evaluate(hand=>({fan:hand.classList.contains('desktop-fan'),layout:document.body.dataset.tableLayout}));
    expect(handMode.fan).toBe(handMode.layout==='ring'&&page.viewportSize().width>850);
    await expect(page.locator('.hand .selected')).toHaveAttribute('data-card',id);
    await page.locator('#chat-toggle').click();await page.locator('#chat-input').fill('更新期间保留草稿');
    for(let i=0;i<3;i++)await page.evaluate(()=>window.__renderReview.redraw());
    await expect(page.locator('#chat-toggle')).toHaveCount(1);await expect(page.locator('#rename-toggle')).toHaveCount(1);
    await expect(page.locator('#chat-input')).toBeFocused();await expect(page.locator('#chat-input')).toHaveValue('更新期间保留草稿');
    extendedChecks.push({name:'20-card-hand-sort-expand-scroll-rotate-social',width,height,count,reach,handMode});
    await context.close();
  }

  for(const webgl of [false,true]) {
    const {context,page}=await open(1440,900,{webgl});
    const record=fixture('trickEnd');record.game.lifecycle={collectionAt:Date.now()+2100,nextTrickAt:Date.now()+2100};
    await page.evaluate(record=>window.__renderReview.apply(record.game),record);
    const id=record.game.trick[0].card.id;
    const getPose=()=>page.evaluate(id=>({pose:window.__renderReview.motion.pose(id),phase:window.__renderReview.state.phase,
      transform:document.querySelector('.played[data-card-id="'+id+'"] .card')?.style.transform,
      mesh:window.__renderReview.scene?.cards.get(id)?.visible}),id);
    expect((await getPose()).pose.collect).toBe(0);
    await page.locator('#table-menu').click();await page.locator('#table-menu').click();
    await page.locator('#chat-toggle').click();await page.locator('#chat-input').fill('收牌期间草稿');
    await page.evaluate(()=>window.__renderReview.redraw());
    await page.setViewportSize({width:844,height:390});
    await expect.poll(async()=>(await getPose()).pose.collect,{intervals:[40],timeout:4000}).toBeGreaterThan(0);
    const moving=await getPose();expect(moving.pose.collect).toBeLessThan(1);
    await expect.poll(async()=>(await getPose()).pose.collect,{intervals:[50],timeout:4000}).toBe(1);
    const settled=await getPose();expect(settled.phase).toBe('trickEnd');
    if(webgl)await expect.poll(()=>page.evaluate(id=>window.__renderReview.scene.cards.get(id).visible,id)).toBe(false);
    else await expect.poll(()=>page.locator('.played[data-card-id="'+id+'"] .card').evaluate(node=>Number(node.style.opacity))).toBe(0);
    await expect(page.locator('#chat-input')).toHaveValue('收牌期间草稿');
    await page.waitForTimeout(200);
    const idle=await measure(page,'settled-collection-idle',()=>page.waitForTimeout(300),{settle:0});expect(idle.drawHTML).toBe(0);
    extendedChecks.push({name:'future-six-card-collection-wakes-and-survives-menu-chat-resize',webgl,moving,settled,idle});
    await context.close();
  }

  {
    const {context,page,releaseImages}=await open(1440,900,{reduced:true,record:fixture('trickEnd'),holdImages:true});
    const before=await page.evaluate(()=>[...window.__renderReview.scene.textures.values()].map(texture=>({ready:texture.userData.faceReady,version:texture.version,width:texture.image.width,height:texture.image.height})));
    expect(before.length).toBeGreaterThan(0);expect(before.some(texture=>!texture.ready)).toBe(true);
    await page.evaluate(()=>window.__renderReview.reset());await releaseImages();
    await expect.poll(()=>page.evaluate(()=>[...window.__renderReview.scene.textures.values()].every(texture=>texture.userData.faceReady))).toBe(true);
    await expect.poll(()=>page.evaluate(()=>window.__renderReview.read().webgl)).toBeGreaterThan(0);
    const after=await page.evaluate(()=>window.__renderReview.read());
    await page.waitForTimeout(200);
    const idle=await measure(page,'decoded-texture-idle',()=>page.waitForTimeout(300),{settle:0});expect(idle.webgl).toBe(0);
    const supported=await page.evaluate(()=>{
      window.__loseContext=window.__renderReview.scene.renderer.getContext().getExtension('WEBGL_lose_context');
      if(!window.__loseContext)return false;window.__loseContext.loseContext();return true;
    });
    let contextRecovery=null;
    if(supported){
      await expect.poll(()=>page.evaluate(()=>document.body.classList.contains('has-webgl'))).toBe(false);
      await expect.poll(()=>page.evaluate(()=>window.__renderReview.read().drawHTML)).toBeGreaterThan(0);
      await page.waitForTimeout(200);await page.evaluate(()=>window.__loseContext.restoreContext());
      await expect.poll(()=>page.evaluate(()=>document.body.classList.contains('has-webgl'))).toBe(true);
      await expect.poll(()=>page.evaluate(()=>!window.__renderReview.scene.lost)).toBe(true);
      await expect.poll(()=>page.evaluate(()=>window.__renderReview.read().webgl)).toBeGreaterThan(0);
      await page.waitForTimeout(250);
      contextRecovery=await page.evaluate(()=>window.__renderReview.read());
    }
    // Headless Chromium keeps pages visible, so exercise the visibility event
    // explicitly. This covers the wake-up handler, not OS background throttling.
    await page.evaluate(()=>{window.__reviewHidden=true;Object.defineProperty(document,'hidden',{configurable:true,get:()=>window.__reviewHidden});document.dispatchEvent(new Event('visibilitychange'));});
    const hidden=await measure(page,'hidden-idle',()=>page.waitForTimeout(300),{settle:0});expect(hidden.webgl).toBe(0);
    await page.evaluate(()=>{window.__reviewHidden=false;document.dispatchEvent(new Event('visibilitychange'));});
    await expect.poll(()=>page.evaluate(()=>window.__renderReview.read().webgl)).toBeGreaterThan(0);
    await page.waitForTimeout(200);
    const returned=await measure(page,'visible-static-idle',()=>page.waitForTimeout(300),{settle:0});expect(returned.webgl).toBe(0);
    extendedChecks.push({name:'delayed-image-static-redraw-context-recovery-visibility-wake',before,after,idle,contextRestoreSupported:supported,contextRecovery,hidden,returned,visibility:'synthetic event; no claim about OS throttling'});
    await context.close();
  }
  console.log(JSON.stringify({extendedChecks,errors}));
}
