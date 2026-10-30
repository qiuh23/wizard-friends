import { chromium, expect } from '@playwright/test';
import fs from 'node:fs';
import { createGame, addPlayer, act, viewFor } from '../src/game.js';
import { createRandomStream } from '../src/random.js';
import { DEFAULT_OPTIONS } from '../src/rules-options.js';

// Manual local review. Legal engine records and response-only inspection hooks
// exercise production rendering without adding a product debugging API or CI job.
const base=process.env.GAME_URL || 'http://127.0.0.1:5193/';
const out='output/playwright'; fs.mkdirSync(out,{recursive:true});
const browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL || 'chrome',headless:true});
const errors=[],checks=[];
const observe=page=>page.on('pageerror',e=>errors.push(e.message));

function fixture(round=1) {
  const game=createGame(); game.randomState=createRandomStream(Array(11).fill(5));
  for(let i=0;i<6;i++) addPlayer(game,`p${i}`,['青岚','云舒','风行','竹影','星河','雨晴'][i]);
  act(game,'p0',{type:'start',options:{...DEFAULT_OPTIONS,short:true,strict:false}});
  for(let step=0;step<10000;step++) {
    if(game.round===round && game.phase==='play' && game.trick.length===5 && game.completedTricks===game.cardsPerRound-1)
      return {version:1,role:'practice',room:'离线练习',me:'p0',game,identities:{}};
    const id=game.players[game.turn].id,view=viewFor(game,id);
    if(game.phase==='trump') act(game,id,{type:'trump',suit:'blue'});
    else if(game.phase==='bid') act(game,id,{type:'bid',value:view.bids[0]});
    else if(game.phase==='play') act(game,id,{type:'play',card:view.legal[0]});
    else act(game,'p0',{type:'next'});
  }
  throw Error('Could not create last-card fixture');
}

async function nicknameReview() {
  const context=await browser.newContext(),page=await context.newPage(); observe(page);
  await page.goto(base); await expect(page.locator('#nickname')).toHaveValue('');
  await page.locator('#nickname').fill('常用名字'); await page.reload();
  await expect(page.locator('#nickname')).toHaveValue('常用名字');
  const token=await page.evaluate(()=>sessionStorage.getItem('wizard-player-token'));
  const second=await context.newPage(); observe(second); await second.goto(base);
  await expect(second.locator('#nickname')).toHaveValue('常用名字');
  expect(await second.evaluate(()=>sessionStorage.getItem('wizard-player-token'))).not.toBe(token);
  await page.locator('#practice').click(); await page.locator('#quick-settings summary').click();
  await page.locator('#rename-toggle').click();
  await page.locator('#rename-input').fill('改名已保存'); await page.locator('#rename-form button').click();
  await expect(page.locator('.my-seat .seat-name b')).toHaveText('改名已保存');
  await page.locator('#quick-settings summary').click();
  page.on('dialog',dialog=>dialog.accept()); await page.locator('#leave').click();
  await expect(page.locator('#nickname')).toHaveValue('改名已保存');
  await second.reload(); await expect(second.locator('#nickname')).toHaveValue('改名已保存');
  const storageState=await context.storageState(); await context.close();
  const reopened=await browser.newContext({storageState}),newPage=await reopened.newPage(); observe(newPage);
  await newPage.goto(base); await expect(newPage.locator('#nickname')).toHaveValue('改名已保存');
  expect(await newPage.evaluate(()=>sessionStorage.getItem('wizard-player-token'))).not.toBe(token);
  await reopened.close();
  for(const automatic of [false,true]) {
    const legacy=await browser.newContext();
    await legacy.addInitScript(automatic=>{
      sessionStorage.setItem('wizard-name','旧手动名字');
      sessionStorage.setItem('wizard-name-automatic',String(automatic));
    },automatic);
    const p=await legacy.newPage(); observe(p); await p.goto(base);
    await expect(p.locator('#nickname')).toHaveValue(automatic?'':'旧手动名字'); await legacy.close();
  }
  checks.push({nickname:'new tab, reload, rename, leave, reopened browser storage, independent tokens, legacy migration'});
}

async function scoreReview({width,height,round=1,role='host',webgl=true,reduced=false}) {
  const context=await browser.newContext({viewport:{width,height},reducedMotion:reduced?'reduce':'no-preference'});
  await context.addInitScript(({record,webgl})=>{
    record.game.turnDeadline=Date.now()+600000;
    if(!sessionStorage.getItem('wizard-room-session')) sessionStorage.setItem('wizard-room-session',JSON.stringify(record));
    localStorage.setItem('wizard-low-graphics','true');localStorage.setItem('wizard-trump-motion','false');localStorage.setItem('wizard-turn-sound','false');
    if(!webgl) {
      const original=HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext=function(kind,...args){return kind.startsWith('webgl')?null:original.call(this,kind,...args);};
    }
  },{record:fixture(round),webgl});
  const page=await context.newPage(); observe(page);
  await page.route(/\/src\/main\.js(?:\?|$)/,async route=>{
    const response=await route.fetch(); await route.fulfill({response,body:await response.text()+`
      window.__scoreReview={
        get game(){return game;},get effect(){return scoreBubbles.effect;},
        async refresh(initial=false,role='host') {
          clearTimeout(turnTimer);clearTimeout(botTimer);spectating=role==='spectator';
          isHost=role==='host';me=spectating?'observer':role==='guest'?'p1':'p0';
          const {spectatorView}=await import('/src/game.js');
          state=spectating?spectatorView(game):viewFor(game,me);state.lifecycle={};
          updateEventEffects(initial);render();notify('');
        },
        async settle(role) {
          const id=game.players[game.turn].id;
          applyPublicAction(game,id,{type:'play',card:viewFor(game,id).legal[0]});
          await this.refresh(false,role);
          if(!spectating) persistRoom();
        }
      };`});
  });
  await page.goto(base);await page.locator('.table').waitFor();
  if(webgl) await page.waitForFunction(()=>document.body.classList.contains('has-webgl'));
  await page.evaluate(role=>window.__scoreReview.refresh(true,role),role);
  if(role==='host') {
    await page.locator('#table-menu').click();await expect(page.locator('#room-dissolve')).toBeVisible();
    const menu=await page.locator('#room-dissolve').evaluate(button=>{
      const range=document.createRange();range.selectNodeContents(button);
      return {lines:range.getClientRects().length,scroll:button.scrollWidth,width:button.clientWidth};
    });
    expect(menu.lines).toBe(1);expect(menu.scroll).toBeLessThanOrEqual(menu.width);
    await page.screenshot({path:`${out}/room-menu-${width}x${height}.png`});
    await page.locator('#table-menu').click();
  }
  await page.evaluate(role=>window.__scoreReview.settle(role),role);
  const bubbles=page.locator('.round-score-bubble');await expect(bubbles).toHaveCount(6);
  const expected=await page.evaluate(()=>window.__scoreReview.game.history.at(-1).result.map(r=>({id:r.id,text:(r.delta>=0?'+':'')+r.delta})));
  expect(expected.some(r=>r.text.startsWith('+'))).toBe(true);expect(expected.some(r=>r.text.startsWith('-'))).toBe(true);
  for(const result of expected) await expect(page.locator(`[data-player-details="${result.id}"] .round-score-bubble`)).toHaveText(result.text);
  await page.waitForTimeout(300);
  const bounds=await bubbles.evaluateAll(nodes=>nodes.map(node=>{
    const b=node.getBoundingClientRect(),a=node.parentElement.getBoundingClientRect();
    return {left:b.left,right:b.right,top:b.top,bottom:b.bottom,avatarTop:a.top,viewportWidth:innerWidth,viewportHeight:innerHeight};
  }));
  fs.writeFileSync(`${out}/score-bubbles-last-bounds.json`,JSON.stringify({width,height,role,bounds},null,2));
  await page.screenshot({path:`${out}/score-bubbles-${width}x${height}-${role}.png`});
  for(const b of bounds) {
    expect(b.left).toBeGreaterThanOrEqual(0);expect(b.right).toBeLessThanOrEqual(b.viewportWidth);
    expect(b.top).toBeGreaterThanOrEqual(0);expect(b.bottom).toBeLessThanOrEqual(b.avatarTop+(width<=850?11:0));
  }
  const start=await page.evaluate(()=>window.__scoreReview.effect.start);
  await page.evaluate(role=>window.__scoreReview.refresh(false,role),role);
  expect(await page.evaluate(()=>window.__scoreReview.effect.start)).toBe(start);
  await page.waitForTimeout(600);await expect(bubbles).toHaveCount(6);
  await expect(bubbles).toHaveCount(0,{timeout:1800});
  let settlement=null;
  if(round===1) {
    const panel=page.locator('.round-settlement');
    settlement=await panel.evaluate(panel=>{
      const style=getComputedStyle(panel),r=panel.getBoundingClientRect();
      return {border:style.borderTopWidth,background:style.backgroundColor,shadow:style.boxShadow,
        width:r.width,height:r.height,left:r.left,right:r.right,top:r.top,bottom:r.bottom};
    });
    expect(settlement.border).toBe('0px');expect(settlement.background).toBe('rgba(0, 0, 0, 0)');
    expect(settlement.shadow).toBe('none');expect(settlement.height).toBeLessThanOrEqual(100);
    const button=await page.locator('#next').evaluate(button=>{
      const r=button.getBoundingClientRect();
      return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,height:r.height,
        hit:button.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2))};
    });
    expect(button.left).toBeGreaterThanOrEqual(0);expect(button.right).toBeLessThanOrEqual(width);
    expect(button.bottom).toBeLessThanOrEqual(height);expect(button.height).toBeGreaterThanOrEqual(44);expect(button.hit).toBe(true);
    const textLayout=await panel.evaluate(panel=>{
      const rect=selector=>{const r=panel.querySelector(selector).getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom};};
      return {title:rect('.action-title'),score:rect('.personal-result'),copy:rect('.round-settlement-copy')};
    });
    expect(textLayout.copy.right).toBeLessThanOrEqual(button.left);
    if(Math.abs(textLayout.title.top-textLayout.score.top)<12) expect(textLayout.score.left-textLayout.title.right).toBeLessThanOrEqual(16);
    await panel.locator('.settlement-details summary').click();
    await expect(panel.locator('.settlement-details-body')).toBeVisible();
    await expect(panel.locator('.settlement-details-body')).toContainText('每差 1 墩扣 10 分');
    await expect(panel.locator('.settlement-history tbody tr')).toHaveCount(6);
    await panel.locator('.settlement-details summary').click();
    await page.screenshot({path:`${out}/round-settlement-compact-${width}x${height}.png`});
  }
  await page.evaluate(role=>window.__scoreReview.refresh(false,role),role);await expect(bubbles).toHaveCount(0);
  await page.evaluate(role=>window.__scoreReview.refresh(true,role),role);await expect(bubbles).toHaveCount(0);
  await page.reload();await page.locator('.table').waitFor();await expect(bubbles).toHaveCount(0);
  if(round===1) {
    await expect(page.locator('.round-settlement')).toBeVisible();
    await page.locator('#next').click();await expect(page.locator('.round-settlement')).toHaveCount(0);
    expect(await page.evaluate(()=>window.__scoreReview.game.round)).toBe(2);
  }
  checks.push({width,height,round,role,webgl,reduced,expected,bounds,settlement});await context.close();
}

try {
  await nicknameReview();
  for(const options of [
    {width:1440,height:900},
    {width:1280,height:720,webgl:false},
    {width:390,height:844,webgl:false},
    {width:320,height:568,webgl:false},
    {width:844,height:390,webgl:false},
    {width:844,height:390,round:5,role:'guest'},
    {width:320,height:568,round:5,role:'spectator',webgl:false,reduced:true},
  ]) await scoreReview(options);
  expect(errors).toEqual([]);
  fs.writeFileSync(`${out}/nickname-score-review.json`,JSON.stringify({checks,errors},null,2));
  console.log(JSON.stringify({checks:checks.length,errors}));
} finally { await browser.close(); }
