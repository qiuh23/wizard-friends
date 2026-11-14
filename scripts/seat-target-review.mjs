import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { createGame, addPlayer, act } from '../src/game.js';
import { DEFAULT_OPTIONS } from '../src/rules-options.js';
const game=createGame();for(let i=0;i<6;i++)addPlayer(game,`p${i}`,['远帆探险的旅人','青山学徒的长昵称','青山守林的长昵称','星河','林语','晓月'][i]);
act(game,'p0',{type:'start',options:{...DEFAULT_OPTIONS,predictionMode:'public'}});
const record={version:1,role:'practice',room:'离线练习',me:'p0',game,identities:{}};
const browser=await chromium.launch({executablePath:process.env.BROWSER_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
const out='../wizard-checkpoint/qa';await fs.mkdir(out,{recursive:true});const results=[];
try {for(const [width,height] of [[1280,800],[390,844],[320,568],[844,390],[568,320]]) {
 const context=await browser.newContext({viewport:{width,height},hasTouch:width<1000,reducedMotion:'reduce'});
 await context.addInitScript(record=>{record.game.turnDeadline=Date.now()+600000;sessionStorage.setItem('wizard-room-session',JSON.stringify(record));localStorage.setItem('wizard-trump-motion','false');localStorage.setItem('wizard-low-graphics','true');},record);
 const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(process.env.GAME_URL||'http://127.0.0.1:5173');await page.locator('.own-status').waitFor();await page.waitForTimeout(400);
 const bounds=await page.locator('.seat-details').evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect(),avatar=n.querySelector('.avatar').getBoundingClientRect(),name=n.querySelector('.seat-name,.own-name').getBoundingClientRect(),hit=document.elementFromPoint(name.x+Math.min(name.width/2,4),name.y+name.height/2);return {width:r.width,height:r.height,x:r.x,y:r.y,right:r.right,bottom:r.bottom,avatarWidth:avatar.width,nameHit:n.contains(hit)};}));
 for(const b of bounds){assert.ok(b.width>=44&&b.height>=44,`small target ${width}: ${JSON.stringify(b)}`);assert.ok(b.x>=0&&b.y>=0&&b.right<=width+1&&b.bottom<=height+1,`clipped target ${width}`);assert.ok(b.nameHit,`name not clickable ${width}`);}
 const metrics=await page.locator('.prediction,.own-metrics').evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return {w:r.width,h:r.height,visible:getComputedStyle(n).visibility!=='hidden',text:n.textContent};}));assert.equal(metrics.length,6);assert.ok(metrics.every(m=>m.visible&&m.w>0&&m.h>0&&m.text.includes('赢')&&m.text.includes('估')));
 const first=page.locator('.player .seat-details').first();await first.focus();await page.keyboard.press('Enter');await page.locator('#table-score-panel').waitFor({state:'visible'});assert.equal(await first.getAttribute('aria-expanded'),'true');await page.keyboard.press('Escape');await page.locator('#table-score-panel').waitFor({state:'hidden'});assert.equal(await first.evaluate(n=>document.activeElement===n),true);
 await first.locator('.seat-name').click();await page.locator('.close-scores').click();assert.equal(await first.evaluate(n=>document.activeElement===n),true);await first.press('Space');await page.locator('#table-score-panel').waitFor({state:'visible'});await page.keyboard.press('Escape');await page.screenshot({path:`${out}/${width}x${height}.png`});assert.deepEqual(errors,[]);results.push({width,height,bounds,metrics,keyboard:true});await context.close();
}await fs.writeFile(`${out}/results.json`,JSON.stringify(results,null,2));console.log('Seat targets passed',results.length,'viewports');}finally{await browser.close();}
