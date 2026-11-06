import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createServer } from '../server/index.js';
import { createGame, addPlayer, act, viewFor } from '../src/game.js';
import { DEFAULT_OPTIONS } from '../src/rules-options.js';
import { createRandomStream } from '../src/random.js';

// Local fixtures exercise the production transport and projections. No test
// endpoint or arbitrary-state hook is shipped to the client or Worker.
const before = process.argv.includes('--before'), edition = process.env.SITE_EDITION || 'global';
const evidence = 'docs/qa/table-polish'; mkdirSync(evidence, { recursive:true });
execFileSync(process.execPath, ['node_modules/vite/bin/vite.js','build'], {env:{...process.env,SITE_EDITION:edition},stdio:'pipe'});
execFileSync(process.execPath, ['scripts/build-info.mjs'], {env:{...process.env,SITE_EDITION:edition},stdio:'pipe'});
const port = edition==='cn'?39442:39441, base=`http://127.0.0.1:${port}`;
const app=await createServer({port,publicOrigin:base,databasePath:':memory:',env:{SITE_EDITION:edition}}); await app.listen();
const browser=await chromium.launch({channel:'msedge',headless:true});
const errors=[], checks=[];
const context=await browser.newContext({viewport:{width:1440,height:900},reducedMotion:'reduce'});
const page=await context.newPage(); page.on('pageerror',e=>errors.push(e.message));
let room, authority, host;
function fixture(phase='bid', mode='public', count=3) {
  const g=createGame();g.randomState=createRandomStream(Array(11).fill(4));
  for(const [id,name] of [[host,'🐧企鹅'],['p1','👍🏽好友'],['p2','🇨🇳朋友'],['p3','👨‍👩‍👧‍👦一家'],['p4','𠮷星'],['p5','Alice']].slice(0,count))addPlayer(g,id,name);
  act(g,host,{type:'start',options:{...DEFAULT_OPTIONS,predictionMode:mode}});
  for(let step=0;step<30000;step++) {
    if(g.round===Math.floor(60/count) && g.phase===phase && (phase!=='bid'||mode!=='public'||g.players[g.turn].id===host) && (phase!=='play'||g.trick.length===count-1))return g;
    if(g.phase==='trump')act(g,g.players[g.turn].id,{type:'trump',suit:'blue'});
    else if(g.phase==='bid') {const p=g.players.find(p=>viewFor(g,p.id).canBid);act(g,p.id,{type:'bid',value:viewFor(g,p.id).bids[0]});}
    else if(g.phase==='play') {const id=g.players[g.turn].id;act(g,id,{type:'play',card:viewFor(g,id).legal[0]});}
    else if(['trickEnd','roundEnd'].includes(g.phase))act(g,host,{type:'next'});
    else throw Error('Fixture cannot reach '+phase);
  }
  throw Error('Fixture exhausted');
}
async function publish(g) {
  authority.record.game=g;
  await app.contexts.get(room).execute(()=>app.contexts.get(room).controller.persistAndPublish(room));
  await expect(page.locator('body')).toHaveAttribute('data-phase',g.phase);
}
async function shot(name){await page.screenshot({path:`${evidence}/${before?'before':'after'}-${edition}-${name}.png`});}
try {
  await page.goto(base); if(edition==='global')await page.locator('#nickname').fill('🐧企鹅');
  await page.locator('#create').click(); await page.locator('#start').waitFor();
  room=(await page.locator('.room-code').textContent()).trim().replace(/^[AC]-/,'');
  authority=app.contexts.get(room).controller.authority; host=authority.record.hostId;
  await shot('lobby');
  if(!before && edition==='global') {
    for(const glyph of ['汉','A','🐧','👍🏽','🇨🇳','👨‍👩‍👧‍👦','𠮷']) {
      const lobby=authority.game;lobby.players[0].name=glyph+'好友';await publish(lobby);
      await expect(page.locator('.seat:not(.empty) .avatar').first()).toHaveText(glyph);
    }
    checks.push('seven nickname graphemes in lobby');
  }
  if(!before&&edition==='global'){
    const lobby=authority.game;lobby.chat=[{seq:1,player:'friend',name:'朋友',text:'候场打个招呼',time:Date.now()}];lobby.chatSeq=1;await publish(lobby);await page.locator('.chat-notice').waitFor();await shot('lobby-chat');
  }
  let g=fixture(); await publish(g);
  for(const viewport of [{width:1440,height:900},{width:390,height:844},{width:844,height:390}]){
    await page.setViewportSize(viewport); await page.locator('.bid-options').waitFor();
    await page.waitForTimeout(300); await shot(`${viewport.width}-bid`);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&document.documentElement.scrollHeight<=innerHeight+1),true);
    if(!before) {
      await expect(page.locator('.avatar[data-bid-state="waiting"]')).toHaveCount(1);
      await expect(page.locator('.action-panel.bid-attention')).toHaveCount(1);
      assert.equal(await page.locator('.bid-options').evaluate(n=>getComputedStyle(n).scrollbarWidth),'none');
      assert.equal(await page.locator('.bid-attention').evaluate(n=>getComputedStyle(n).animationName),'none');
      await page.locator('[data-bid]').first().focus();await page.keyboard.press('End');
      await expect(page.locator('[data-bid]').last()).toBeFocused();
      assert.equal(await page.locator('[data-bid]').last().evaluate(n=>{const r=n.getBoundingClientRect(),g=n.parentElement.getBoundingClientRect();return r.left>=g.left-1&&r.right<=g.right+1;}),true);
      await page.keyboard.press('Home');await expect(page.locator('[data-bid]').first()).toBeFocused();
      const overflow=await page.locator('.bid-options').evaluate(n=>n.scrollWidth>n.clientWidth);
      if(overflow){await page.locator('.bid-options').hover();await page.mouse.wheel(0,180);await expect.poll(()=>page.locator('.bid-options').evaluate(n=>n.scrollLeft)).toBeGreaterThan(0);}
      if(viewport.width===390&&overflow){
        await page.locator('.bid-options').evaluate(n=>n.scrollLeft=0);
        const box=await page.locator('.bid-options').boundingBox(),cdp=await context.newCDPSession(page),x=box.x+box.width-25,y=box.y+25;
        await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
        for(let step=1;step<=7;step++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x-step*25,y}]});await page.waitForTimeout(20);}
        await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
        await expect.poll(()=>page.locator('.bid-options').evaluate(n=>n.scrollLeft)).toBeGreaterThan(0);
        await expect(page.locator('.bid-attention')).toHaveCount(1);await cdp.detach();
      }
      checks.push(`${viewport.width}: public own cue, reduced motion, hidden scrollbar, Home/End and wheel`);
    }
  }
  if(!before){await page.emulateMedia({reducedMotion:'no-preference'});assert.equal(await page.locator('.bid-attention').evaluate(n=>getComputedStyle(n).animationName),'bid-breathe');await page.emulateMedia({reducedMotion:'reduce'});}
  await page.setViewportSize({width:1440,height:900});
  g=fixture('play'); await publish(g); await page.locator('.scene-host.ready canvas').waitFor(); await page.waitForTimeout(400); await shot('lighting');
  if(edition==='global') {
    g.chat=[{seq:1,player:'p1',name:'👍🏽好友',text:'到你了，慢慢来。',time:Date.now()}];g.chatSeq=1;await publish(g);
    for(const viewport of [{width:1440,height:900},{width:390,height:844},{width:844,height:390}]) {
      await page.setViewportSize(viewport);
      g.chatSeq++;g.chat.push({seq:g.chatSeq,player:'p2',name:'🇨🇳朋友',text:'下一轮一起加油！',time:Date.now()});await publish(g);
      await page.locator('.chat-notice').first().waitFor();await page.waitForTimeout(250);await shot(`${viewport.width}-chat`);
    }
    await page.locator('#chat-toggle').click();await expect(page.locator('#chat-messages p')).toHaveCount(4);await shot('chat-history');
    if(!before){assert.doesNotMatch(await page.locator('#chat-messages').innerText(),/#\d/);await expect(page.locator('.chat-notice')).toHaveCount(0);}
    await page.locator('#close-chat').click();
  }
  if(!before) {
    for(const glyph of ['汉','A','🐧','👍🏽','🇨🇳','👨‍👩‍👧‍👦','𠮷']) {
      if(edition!=='global')break;
      g.players[0].name=glyph+'好友';await publish(g);
      await expect(page.locator('.own-status .avatar-glyph')).toHaveText(glyph);
      assert.equal(await page.locator('.own-status .avatar-glyph').evaluate(n=>n.scrollWidth<=n.clientWidth+1),true);
    }
    for(const mode of ['public','hidden','secret']) {
      g=fixture('bid',mode);await publish(g);
      await expect(page.locator('.avatar[data-bid-state="waiting"]')).toHaveCount(mode==='public'?1:3);
      await page.locator('[data-bid="2"]').click();
      await expect(page.locator('.own-status .avatar')).toHaveAttribute('data-bid-state','submitted');
      await expect(page.locator('.bid-attention')).toHaveCount(0);
      if(mode!=='public') {
        const watcherContext=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'}),watcher=await watcherContext.newPage();
        await watcher.goto(`${base}/?room=${edition==='cn'?'A-':''}${room}&watch=1`);
        await watcher.locator('.spectator-banner').waitFor();
        await expect(watcher.locator('.avatar[data-bid-state="waiting"]')).toHaveCount(2);
        await expect(watcher.locator('.avatar[data-bid-state="submitted"]')).toHaveCount(1);
        await expect(watcher.locator('.action-panel')).toContainText('等待尚未提交的玩家预测');
        await expect(watcher.locator('[data-bid]')).toHaveCount(0);
        assert.equal(await watcher.locator(`[data-player="${host}"] .prediction [aria-label="预测已锁定，未公开"]`).count(),1);
        await watcher.screenshot({path:`${evidence}/after-${edition}-${mode}-spectator.png`});
        await context.setOffline(true);
        for(const socket of app.contexts.get(room).sockets)if(socket.data.playerId===host)socket.raw.close();
        await expect(page.locator('.avatar[data-bid-state="waiting"]')).toHaveCount(0);
        await context.setOffline(false);await page.reload();await page.locator('.table').waitFor();
        await expect(page.locator('.own-status .avatar')).toHaveAttribute('data-bid-state','submitted');
        await expect(page.locator('.bid-attention')).toHaveCount(0);
        // A later player's submission must move every observer's waiting cue.
        act(authority.game,'p1',{type:'bid',value:4});await publish(authority.game);
        await expect(watcher.locator('.avatar[data-bid-state="waiting"]')).toHaveCount(1);
        await expect(watcher.locator('.avatar[data-bid-state="submitted"]')).toHaveCount(2);
        await watcherContext.close();
      }
      for(const p of authority.game.players)if(viewFor(authority.game,p.id).canBid)act(authority.game,p.id,{type:'bid',value:0});
      await publish(authority.game);await expect(page.locator('.avatar[data-bid-state="waiting"],.bid-attention')).toHaveCount(0);
      checks.push(`${mode}: submit clears own cue; other pending players, spectator privacy and reconnect use latest state`);
    }
    if(edition==='cn')await expect(page.locator('#chat-toggle,#room-chat,.chat-notices,#rename-panel')).toHaveCount(0);
    g=fixture('play');await publish(g);await page.setViewportSize({width:1440,height:900});await page.locator('.scene-host.ready canvas').waitFor();await shot('lighting');
    g=fixture('play','public',6);await publish(g);
    for(const viewport of [{width:1440,height:900},{width:390,height:844},{width:844,height:390}]){
      await page.setViewportSize(viewport);await expect(page.locator('.played')).toHaveCount(5);
      await page.locator('.scene-host.ready canvas').waitFor();await page.waitForTimeout(200);await shot(`${viewport.width}-five-cards`);
      assert.equal(await page.locator('.played').evaluateAll(nodes=>nodes.every(n=>{const r=n.getBoundingClientRect();return r.x>=0&&r.y>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1;})),true);
    }
    checks.push('six seats and five played cards: desktop, portrait, landscape; glyphs and shadows fit viewport');
    // Force WebGL context loss through the platform event: readable 2D contacts.
    await page.locator('.scene-host canvas').evaluate(canvas=>canvas.dispatchEvent(new Event('webglcontextlost',{cancelable:true})));
    await expect(page.locator('body')).not.toHaveClass(/has-webgl/);await shot('2d-fallback');
    checks.push('readable 2D fallback; no document horizontal overflow');
  }
  assert.deepEqual(errors,[]);writeFileSync(`${evidence}/${before?'before':'after'}-${edition}-checks.json`,JSON.stringify({checks,errors},null,2));
  console.log(`${edition}: captured table, bid, avatars and chat (${before?'baseline':'updated'}).`);
} finally {await context.close();await browser.close();await app.close();}
