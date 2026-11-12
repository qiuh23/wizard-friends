// Local-only acceptance harness. Test hooks are response rewrites, never shipped.
import fs from 'node:fs';
import { chromium, expect } from '@playwright/test';
import { createGame, addPlayer, act } from '../src/game.js';
import { createRandomStream } from '../src/random.js';
import { DEFAULT_OPTIONS } from '../src/rules-options.js';

const base=process.env.GAME_URL || 'http://127.0.0.1:5173/';
const output='output/playwright/wizard-mobile';fs.mkdirSync(output,{recursive:true});
const browser=await chromium.launch({headless:true,
  ...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{channel:process.env.BROWSER_CHANNEL||'chrome'})});
const errors=[],results=[];
function fixture(count,phase) {
  const game=createGame();game.randomState=createRandomStream(Array(11).fill(14));
  for(let i=0;i<count;i++)addPlayer(game,`p${i}`,['青岚','云舒','风行','清月','星河','林语'][i]);
  act(game,'p0',{type:'start',options:DEFAULT_OPTIONS});
  game.phase=phase;game.turn=0;game.reveal={id:'yellow-4',kind:'number',suit:'yellow',rank:4};game.trump='yellow';
  game.players.forEach(p=>{p.bot=false;p.bid=phase==='bid'?null:0;});
  if(phase==='play')game.trick=game.players.map((_,player)=>({player,
    card:player===0?{id:'fixture-wizard',kind:'wizard'}:player===1?{id:'fixture-jester',kind:'jester'}:
      {id:`fixture-yellow-${player}`,kind:'number',suit:'yellow',rank:player+1}}));
  return {version:1,role:'practice',room:'离线练习',me:'p0',game,identities:{}};
}
for(const [width,height,count] of [[844,390,3],[667,275,6],[1024,460,6],[390,844,6],[1280,800,6]]) {
  for(const phase of ['bid','play']) {
    const context=await browser.newContext({viewport:{width,height},reducedMotion:'reduce'});
    await context.addInitScript(record=>{
      const now=Date.now();Date.now=()=>now;record.game.turnDeadline=now+45000;record.remainingMs=45000;
      sessionStorage.setItem('wizard-room-session',JSON.stringify(record));localStorage.setItem('wizard-low-graphics','false');
    },fixture(count,phase));
    const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
    await page.route(/\/src\/table-scene\.js(?:\?|$)/,async route=>{
      const response=await route.fetch();await route.fulfill({response,body:(await response.text()).replace('this.buildTrump();','this.buildTrump();window.__mobileScene=this;')});
    });
    await page.goto(base);await page.waitForFunction(()=>window.__mobileScene?.motion && document.body.classList.contains('has-webgl'));
    await page.evaluate(()=>window.__mobileScene.assetLoad);
    const record={width,height,count,phase};
    if(phase==='bid') {
      const buttons=page.locator('.bid-options .bid');await expect(buttons).toHaveCount(2);
      for(const button of await buttons.all()) {
        const box=await button.boundingBox();expect(box.width).toBe(44);expect(box.height).toBe(44);
        expect(await button.evaluate(node=>getComputedStyle(node).borderRadius)).toBe('10px');
      }
      record.panel=await page.locator('.action-panel:has(.bid-options)').boundingBox();expect(record.panel.width).toBeLessThan(220);
    } else {
      record.scene=await page.evaluate(()=>{
        const s=window.__mobileScene;s.resize();s.drawCards(s.motion.snapshot());s.renderer.render(s.scene,s.camera);
        const figures=[...s.cards.values()].filter(g=>g.userData.figurine).map(g=>({name:g.userData.figurine.name,
          visible:g.userData.figurine.visible,cardParent:g.userData.figurine.parent===g,y:g.userData.figurine.position.y,triangles:g.userData.figurine.geometry.attributes.position.count/3}));
        const result={figures,lights:s.updateAssetLighting(),calls:s.renderer.info.render.calls};
        for(const low of [true,false,true,false])s.setLow(low);
        result.figureCount=[...s.cards.values()].filter(g=>g.userData.figurine?.parent===g).length;
        return result;
      });
      expect(record.scene.figureCount).toBe(2);expect(record.scene.figures.every(f=>f.visible&&f.cardParent&&Math.abs(f.y-.027)<1e-6)).toBeTruthy();
      expect(record.scene.lights.pointLights).toBeLessThanOrEqual(width<600||height<=540?2:4);
      expect(await page.locator('.played.winner .played-state').evaluate(node=>getComputedStyle(node).backgroundColor)).toBe('rgb(9, 44, 72)');
    }
    await page.screenshot({path:`${output}/${width}x${height}-${count}-${phase}.png`});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
    results.push(record);await context.close();
  }
}
await browser.close();fs.writeFileSync(`${output}/results.json`,JSON.stringify({results,errors},null,2));
expect(errors).toEqual([]);console.log(`Passed ${results.length} local mobile/desktop snapshots. Inspect overlap and lighting in the PNGs.`);
