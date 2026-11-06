import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';

// Explicit local QA only. Use the unchanged Node adapter behind each edition's
// Vite preview; this script never connects to a public game or starts a release.
const urls = { global: process.env.GLOBAL_URL || 'http://127.0.0.1:5212/', cn: process.env.CN_URL || 'http://127.0.0.1:5222/' };
for (const url of Object.values(urls)) assert(['localhost', '127.0.0.1'].includes(new URL(url).hostname));
const out = 'docs/qa/visual-first';
await fs.mkdir(out, { recursive:true });
const browser = await chromium.launch({ channel:process.env.BROWSER_CHANNEL || 'chrome', headless:true });
const errors = [], results = [];
const sizes = [['desktop',1440,1000],['portrait',390,844],['landscape',844,390],['narrow',320,568]];
const fits = async page => assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'horizontal overflow');
const shot = (page, name) => page.screenshot({ path:`${out}/${name}.png`, fullPage:true });
function listen(page) { page.on('pageerror', e => errors.push(e.message)); }

try {
  for (const [edition, base] of Object.entries(urls)) {
    const context = await browser.newContext({ reducedMotion:'reduce', permissions:['clipboard-read','clipboard-write'] });
    const page = await context.newPage(); listen(page);
    for (const [name,width,height] of sizes) {
      await page.setViewportSize({width,height}); await page.goto(base);
      await page.locator('#create').waitFor(); await page.waitForTimeout(200);
      assert.equal(await page.locator('body').getAttribute('data-site-edition'),edition);
      assert.equal(await page.locator('[data-server-entry]').count(),0);
      assert.equal(await page.locator('input#nickname').count(),edition === 'cn' ? 0 : 1);
      await fits(page);
      await shot(page,`after-${edition}-home-${name}`);
      if (edition === 'global') await page.locator('#nickname').fill('春山访客的十六字以内长昵称');
      await page.locator('#join-menu').click(); await page.locator('#room-input').fill(edition === 'cn' ? 'A-ABCD2345' : 'C-ABCD2345');
      await page.locator('#rules').click(); await expect(page.locator('.modal')).toBeVisible();
      await page.locator('.modal p').first().click(); await expect(page.locator('.modal')).toBeVisible();
      await page.locator('.modal-backdrop').click({position:{x:2,y:2}}); await expect(page.locator('.modal')).toHaveCount(0);
      await expect(page.locator('#room-input')).toHaveValue(edition === 'cn' ? 'A-ABCD2345' : 'C-ABCD2345');
      await page.locator('#quick-settings > summary').click(); await expect(page.locator('.settings-content')).toBeVisible();
      await page.locator('#close-settings').click(); await expect(page.locator('.settings-content')).toBeHidden();
      await page.locator('#quick-settings > summary').click(); await page.locator('.home-title').click(); await expect(page.locator('.settings-content')).toBeHidden();
      await page.locator('#quick-settings > summary').click(); await page.keyboard.press('Escape'); await expect(page.locator('.settings-content')).toBeHidden();
      await page.locator('#join-form button').click(); await expect(page.locator('#notice')).not.toBeEmpty();
      await fits(page);
      results.push({edition,name,home:true,joinDraft:true,rulesInsideAndBackdrop:true,settingsCloseOutsideEscape:true,joinError:true});
    }
    await page.goto(base); if (edition === 'global') await page.locator('#nickname').fill('春山访客的长昵称');
    await page.locator('#create').click(); await page.locator('.lobby-table').waitFor();
    const code = (await page.locator('.room-code').textContent()).trim();
    for (const [name,width,height] of sizes) {
      await page.setViewportSize({width,height}); await page.locator('[data-lobby-panel="rules"]').click();
      assert.equal(await page.locator('.rule-groups fieldset').count(),5);
      assert.equal(await page.locator('#rule-extras').count(),0);
      await page.locator('input[name="foresight"][value="true"]').check(); await fits(page);
      await shot(page,`after-${edition}-setup-${name}`);
      await page.locator('[data-lobby-panel="players"]').click(); await fits(page);
      await shot(page,`after-${edition}-waiting-${name}`);
    }
    await page.locator('#invite').click();
    const invite = await page.evaluate(() => navigator.clipboard.readText());
    const address = new URL(invite); assert.equal(address.origin,new URL(base).origin); assert.equal(address.searchParams.get('room'),code);
    const guestContext = await browser.newContext(); const guest = await guestContext.newPage(); listen(guest); await guest.goto(invite);
    if (edition === 'global') await guest.locator('#nickname').fill('受邀朋友');
    await guest.locator('#join').click(); await guest.locator('.lobby-table').waitFor(); await expect(guest.locator('.room-code')).toHaveText(code);
    if (edition === 'cn') assert.equal(await guest.locator('#chat-toggle').count(),0);
    else {
      await page.locator('#chat-toggle').click(); await page.locator('#chat-input').fill('未提交的聊天草稿');
      await page.locator('#close-chat').click(); await page.locator('#chat-toggle').click(); await expect(page.locator('#chat-input')).toHaveValue('未提交的聊天草稿');
      await page.locator('#chat-form button').click(); await expect(guest.locator('#chat-messages')).toContainText('未提交的聊天草稿'); await page.locator('#close-chat').click();
    }
    while (await page.locator('.seat:not(.empty)').count() < 6) {
      const count = await page.locator('.seat:not(.empty)').count(); await page.locator('#addbot').click();
      await expect(page.locator('.seat:not(.empty)')).toHaveCount(count+1);
    }
    const observerContext = await browser.newContext(); const observer = await observerContext.newPage(); listen(observer); await observer.goto(base);
    const row = observer.locator('.room-directory-item').filter({hasText:code.replace(/^[CA]-/, '')}); await expect(row).toBeVisible();
    await expect(row.locator('.directory-full')).toBeVisible(); await expect(row.locator('button')).toHaveText('观战');
    for (const [name,width,height] of sizes.slice(0,3)) { await observer.setViewportSize({width,height}); await fits(observer); await shot(observer,`after-${edition}-directory-full-${name}`); }
    if (edition === 'global' && process.env.BASELINE_URL) {
      assert(['localhost','127.0.0.1'].includes(new URL(process.env.BASELINE_URL).hostname));
      const baseline = await observerContext.newPage(); await baseline.goto(process.env.BASELINE_URL);
      await baseline.locator('#create').waitFor();
      // The baseline origin is deliberately not authorized by the local relay.
      // Render the same public metadata in its original directory component.
      await baseline.evaluate(async ({room,host}) => {
        const {RoomDirectory} = await import('/src/room-directory.js');
        const target = document.querySelector('.home-room-list'); target.replaceChildren();
        const directory = new RoomDirectory(); directory.mount(target);
        directory.update({rooms:[{room,hostName:host,phase:'lobby',players:6,spectators:0}],status:'ready'});
      }, {room:code.replace(/^[CA]-/, ''),host:'春山访客的长昵称'});
      await expect(baseline.locator('.room-directory-item').filter({hasText:code.replace(/^[CA]-/, '')})).toBeVisible();
      for (const [name,width,height] of sizes.slice(0,3)) { await baseline.setViewportSize({width,height}); await shot(baseline,`before-directory-full-${name}`); }
      await baseline.close();
    }
    await row.locator('button').click(); await expect(observer.locator('.spectator-banner')).toBeVisible();
    await page.locator('#start').click(); await expect(page.locator('.table')).toBeVisible();
    await context.setOffline(true); await expect(page.locator('body')).toHaveAttribute('data-connection','reconnecting');
    await shot(page,`after-${edition}-disconnected`); await context.setOffline(false); await expect(page.locator('body')).toHaveAttribute('data-connection','connected');
    results.push({edition,realRoom:true,inviteCopied:true,guestJoined:true,fullRoomWatch:true,communicationPolicy:true,disconnectRecovery:true});
    await observerContext.close(); await guestContext.close(); await context.close();
  }
  assert.deepEqual(errors,[]);
} finally {
  await fs.writeFile(`${out}/entry-results.json`,JSON.stringify({results,errors},null,2)+'\n'); await browser.close();
}
console.log(JSON.stringify({results,errors},null,2));
