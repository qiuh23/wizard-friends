import { chromium, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from '../server/index.js';
import { createGame, addPlayer } from '../src/game.js';
import { CN_NICKNAMES } from '../src/site-policy.js';

mkdirSync('output/playwright',{recursive:true});
const browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL || 'chrome',headless:true,args:['--disable-webgl']});
const errors=[], results=[];
const assertCN=async page=>{
  await expect(page.locator('[data-safety-notice],#safety-notice,#chat-input,#chat-form,#chat-toggle,#room-chat,#rename-toggle,#rename-panel,.chat-notices,.chat-unread,[data-server-entry]')).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText('旧自由昵称');
};
try {
 for (const edition of ['cn','global']) {
  const env={...process.env,SITE_EDITION:edition};
  execFileSync(process.execPath,['node_modules/vite/bin/vite.js','build'],{env,stdio:'pipe'});
  execFileSync(process.execPath,['scripts/build-info.mjs'],{env,stdio:'pipe'});
  const port=edition==='cn'?39324:39325, base=`http://127.0.0.1:${port}/`;
  const app=await createServer({host:'127.0.0.1',port,publicOrigin:base.slice(0,-1),databasePath:':memory:',env:{SITE_EDITION:edition}});await app.listen();
  const context=await browser.newContext({viewport:{width:1440,height:900}});
  context.on('page',p=>p.on('pageerror',e=>errors.push(`${edition}: ${e.message}`)));
  const page=await context.newPage();
  const ws=[]; page.on('websocket',socket=>ws.push(socket.url()));
  try {
   await page.goto(base+'?SITE_EDITION=global&server=cloudflare');
   await expect(page.locator('#create')).toBeVisible();
   expect(await page.locator('a[data-lobby-navigation]').getAttribute('href')).toBe(edition==='cn'?'https://magical-athlete-online.cn/':'https://magical-athlete.qiuh23.workers.dev/lobby/');
   await expect(page.locator('[data-server-entry]')).toHaveCount(0);
   if(edition==='cn') {
    await assertCN(page);await expect(page.locator('input#nickname')).toHaveCount(0);
    expect(CN_NICKNAMES).toContain(await page.locator('output#nickname').textContent());
    await page.locator('#random-nickname').click();expect(CN_NICKNAMES).toContain(await page.locator('output#nickname').textContent());
    await page.evaluate(()=>{localStorage.setItem('wizard-name:aliyun','旧自由昵称');localStorage.setItem('preferred-backend','cloudflare');localStorage.setItem('wizard-cn-nickname-id:aliyun','wizard-cn-16');});
    await page.reload();await expect(page.locator('#nickname')).toHaveText('北落师门');
   } else await page.locator('#nickname').fill('海外自定义');
   await page.locator('#create').click();await page.locator('[data-lobby-panel=players]').click();await expect(page.locator('#addbot')).toBeVisible();
   const code=(await page.locator('.room-code').textContent()).trim();
   if(edition==='cn') {await assertCN(page);await expect(page.locator('#random-nickname')).toHaveCount(0);}
   else {
    await page.locator('#chat-toggle').click();await page.locator('#chat-input').fill('海外聊天恢复');await page.locator('#chat-form button').click();await expect(page.locator('#chat-messages')).toContainText('海外聊天恢复');
   }
   await page.locator('#addbot').click();await page.locator('#addbot').click();
   const identity=await page.evaluate(edition=>JSON.parse(sessionStorage.getItem(edition==='cn'?'wizard-room-session:aliyun':'wizard-room-session')).me,edition);
   await page.reload();await expect(page.locator('#start')).toBeEnabled();
   expect(await page.evaluate(edition=>JSON.parse(sessionStorage.getItem(edition==='cn'?'wizard-room-session:aliyun':'wizard-room-session')).me,edition)).toBe(identity);
   if(edition==='global'){await page.locator('#chat-toggle').click();await expect(page.locator('#chat-messages')).toContainText('海外聊天恢复');await page.locator('#close-chat').click();}
   else await assertCN(page);
   await page.locator('#start').click();await expect(page.locator('.table')).toBeVisible();
   const watcher=await context.newPage();await watcher.goto(base+`?room=${code}&watch=1`);await expect(watcher.locator('.table')).toBeVisible();
   if(edition==='cn')await assertCN(watcher);
   for(const viewport of [{width:1440,height:900},{width:844,height:390}]) {
    await page.setViewportSize(viewport);
    await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    if(edition==='cn') {
     await assertCN(page);
     await expect(page.locator('.own-name')).toContainText('北落师门');
     expect(await page.locator('.own-name').evaluate(node=>node.scrollWidth<=node.clientWidth+1)).toBe(true);
    }
    await page.screenshot({path:`output/playwright/edition-${edition}-${viewport.width}.png`,fullPage:true});
    results.push({edition,viewport,online:true,spectator:true,identityRecovery:true});
   }
   const foreign=await context.newPage();await foreign.goto(base+`?room=${edition==='cn'?'C':'A'}-ABCDEFGH&watch=1`);
   await expect(foreign.locator('[role=alert]')).toHaveText('此邀请不属于当前站点，请向房主确认原始邀请链接。');expect(new URL(foreign.url()).origin).toBe(new URL(base).origin);await foreign.close();
   expect(ws.every(url=>new URL(url).host===new URL(base).host)).toBe(true);
   if(edition==='cn') {
    const practiceContext=await browser.newContext({viewport:{width:844,height:390}});
    const old=createGame();addPlayer(old,'legacy-host','旧自由昵称');addPlayer(old,'old-bot','旧电脑一',true);addPlayer(old,'old-bot2','旧电脑二',true);old.log=['旧自由昵称 发言'];old.chat=[{name:'旧自由昵称',text:'不应再次显示'}];
    await practiceContext.addInitScript(saved=>{if(!localStorage.getItem('seeded')){localStorage.setItem('wizard-practice-save:aliyun',JSON.stringify(saved));localStorage.setItem('seeded','1');}},{practiceVersion:1,role:'practice',room:'离线练习',game:old,identities:{},me:'legacy-host',paused:false,leftAt:Date.now()});
    const practice=await practiceContext.newPage();practice.on('pageerror',e=>errors.push(e.message));await practice.goto(base);await practice.locator('#resume-practice').click();await expect(practice.locator('#start')).toBeVisible();await assertCN(practice);await expect(practice.locator('body')).not.toContainText('不应再次显示');await practice.locator('#start').click();await expect(practice.locator('.table')).toBeVisible();await assertCN(practice);await practice.reload();await expect(practice.locator('.table')).toBeVisible();await assertCN(practice);await practiceContext.close();results.push({edition,legacyPracticeCache:true});
   }
  } finally {await context.close();await app.close();}
 }
 expect(errors).toEqual([]);writeFileSync('output/playwright/site-edition-results.json',JSON.stringify({results,errors},null,2));console.log(JSON.stringify({results,errors}));
} finally {await browser.close();}

