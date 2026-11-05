import { chromium, webkit, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
const base = process.env.GAME_URL || 'http://127.0.0.1:5184/';
const stage = process.env.UI_STAGE || 'after';
const output = process.env.REVIEW_OUTPUT || 'docs/qa/room-entry-ui';
await mkdir(output, { recursive:true });
const engine=process.env.BROWSER_ENGINE || 'chromium';
const browser = engine==='webkit' ? await webkit.launch({headless:true}) : await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless:true, args:['--disable-webgl'] });
const errors = [], checks = [];
try {
  for (const [label,width,height] of [['desktop',1440,1000],['iphone',390,844],['landscape',844,390],['narrow',320,780]]) {
    const context=await browser.newContext({viewport:{width,height},hasTouch:width<900,isMobile:width<900,reducedMotion:'reduce'});
    const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
    await page.goto(base);
    await page.locator('#nickname').fill('桥大madd');await page.locator('#practice').click();
    await expect(page.locator('.seats .seat')).toHaveCount(6);
    await page.waitForTimeout(250);
    await page.screenshot({path:`${output}/${stage}-${label}${engine==='webkit' ? '-webkit' : ''}.png`,fullPage:true});
    if(stage==='before') {await context.close();continue;}
    await expect(page.locator('#room-rules-panel')).toBeVisible();
    await expect(page.locator('[data-lobby-panel="rules"]')).toHaveAttribute('aria-selected','true');
    await page.locator('#room-rules-panel').focus();await page.keyboard.press('PageDown');
    if(width<=850) await expect.poll(()=>page.locator('.lobby-table').evaluate(n=>n.scrollTop)).toBeGreaterThan(0);
    await page.locator('.lobby-table').evaluate(n=>{n.scrollTop=0;});
    await page.locator('[data-lobby-panel="players"]').click();
    await expect(page.locator('#room-players-panel')).toBeVisible();
    await page.locator('#bot-difficulty').scrollIntoViewIfNeeded();
    await page.screenshot({path:`${output}/after-${label}-bots${engine==='webkit' ? '-webkit' : ''}.png`});
    const sizes=await page.locator('#bot-difficulty,#addbot').evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height};}));
    expect(sizes[0].h).toBeGreaterThanOrEqual(44);expect(sizes[0].h).toBeLessThanOrEqual(48);expect(sizes[0].h).toBe(sizes[1].h);expect(sizes[0].y).toBe(sizes[1].y);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    expect(await page.locator('.seats').evaluate(n=>getComputedStyle(n).gridTemplateColumns.split(' ').length)).toBe(width<=850 ? 2 : 3);
    const seats=await page.locator('.seats .seat').evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return {w:r.width,h:r.height};}));
    expect(Math.max(...seats.map(s=>s.h))-Math.min(...seats.map(s=>s.h))).toBeLessThan(1);expect(Math.max(...seats.map(s=>s.w))-Math.min(...seats.map(s=>s.w))).toBeLessThan(1);
    await page.locator('#bot-difficulty').selectOption('simple');await page.locator('#addbot').click();
    await expect(page.locator('.seat:not(.empty)')).toHaveCount(4);
    expect(await page.locator('#bot-difficulty').inputValue()).toBe('simple');
    await expect(page.locator('.seat:not(.empty)').last()).toContainText('机器人 · 简单');
    for (let i=0;i<2;i++)await page.locator('#addbot').click();
    await expect(page.locator('.seat:not(.empty)')).toHaveCount(6);await expect(page.locator('#addbot')).toHaveCount(0);
    await page.locator('[data-remove]').last().click();await expect(page.locator('#addbot')).toBeVisible();
    await expect(page.locator('#start')).toBeEnabled();
    await page.locator('[data-lobby-panel="rules"]').click();
    await page.locator('#rule-extras > summary').click();
    for (const group of await page.locator('.rule-groups fieldset').all()) {
      await group.locator('label').first().scrollIntoViewIfNeeded();
      expect(await group.locator('label').first().evaluate(n=>{const r=n.getBoundingClientRect();return n.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));})).toBe(true);
    }
    await page.screenshot({path:`${output}/after-${label}-rules${engine==='webkit' ? '-webkit' : ''}.png`});
    const lastRule=page.locator('.rule-groups fieldset').last();
    await lastRule.locator('label').first().scrollIntoViewIfNeeded();
    const rememberedScroll=await page.locator('.lobby-table').evaluate(n=>n.scrollTop);
    if(width<=850) expect(rememberedScroll).toBeGreaterThan(0);
    for (const value of ['false','true']) {
      await lastRule.locator(`input[value="${value}"]`).check();
      expect(Math.abs(await page.locator('.lobby-table').evaluate(n=>n.scrollTop)-rememberedScroll)).toBeLessThan(2);
    }
    await page.locator('[data-lobby-panel="players"]').click();
    await page.locator('[data-lobby-panel="rules"]').click();
    expect(Math.abs(await page.locator('.lobby-table').evaluate(n=>n.scrollTop)-rememberedScroll)).toBeLessThan(2);
    await page.locator('[data-lobby-panel="rules"]').press('ArrowLeft');await expect(page.locator('#room-players-panel')).toBeVisible();
    await page.locator('[data-lobby-panel="players"]').press('ArrowRight');await expect(page.locator('#room-rules-panel')).toBeVisible();
    await page.locator('#start').scrollIntoViewIfNeeded();
    const clear=await page.locator('#start').evaluate(n=>{const r=n.getBoundingClientRect();const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return n.contains(hit);});expect(clear).toBe(true);
    await page.screenshot({path:`${output}/after-${label}-bottom${engine==='webkit' ? '-webkit' : ''}.png`});
    // The viewport changes with Safari's browser chrome and device rotation.
    await page.setViewportSize({width,height:height-90});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.locator('#quick-settings > summary').click();await expect(page.locator('.settings-content')).toBeVisible();await page.locator('#quick-settings > summary').click();
    await page.locator('#chat-toggle').click();await expect(page.locator('#room-chat')).toBeVisible();await page.locator('#close-chat').click();
    await page.locator('#quick-settings > summary').click();await page.locator('#rename-toggle').click();
    const longName='这是用于检查长昵称布局的巫师玩家'.slice(0,16);
    await page.locator('#rename-input').fill(longName);await page.locator('#rename-form button').click();
    await expect(page.locator('.seats .seat').first().locator('b')).toHaveText(longName);
    await page.locator('[data-lobby-panel="players"]').click();
    const clipped=await page.locator('.seats .seat').first().evaluate(seat=>{const name=seat.querySelector('b'),r=name.getBoundingClientRect(),card=seat.getBoundingClientRect();return getComputedStyle(name).textOverflow==='ellipsis'&&r.right<=card.right&&r.width<=card.width;});expect(clipped).toBe(true);
    checks.push({label,width,height,equalBotTargets:sizes[0].h,uniformSeats:seats[0],fullCapacityHidesAdd:true,startUnobscured:true,dynamicViewport:true,lowerRuleScrollPreserved:true,longNicknameClipped:true,hostDefaultsRules:true,panelsPreserved:true});
    await context.close();
  }
  expect(errors).toEqual([]);
  await writeFile(`${output}/${stage}-${engine}-checks.json`,JSON.stringify({stage,engine,checks,errors},null,2)+'\n');
  console.log(JSON.stringify({stage,engine,checks,errors}));
} finally {await browser.close();}
