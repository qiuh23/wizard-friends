import {test,expect} from './fixtures.js';

const targets={aliyun:'https://magical-athlete-online.cn/',cloudflare:'https://magical-athlete.qiuh23.workers.dev/lobby/'};
async function runtime(page,backend) {
  await page.route('**/runtime-config.json',route=>route.fulfill({json:{backendId:backend,relayOrigin:'',backends:[
    {id:backend,origin:'http://127.0.0.1:3196',enabled:true},
    {id:backend==='aliyun'?'cloudflare':'aliyun',origin:'https://disabled.example',enabled:false},
  ]}}));
  await page.addInitScript(()=>{for(const suffix of ['',':aliyun'])localStorage.setItem(`wizard-low-graphics${suffix}`,'true');});
}

for(const backend of ['aliyun','cloudflare']) test(`${backend} 返回对应大厅需确认暂离，保留原身份且地址与 Referer 不携带令牌`,async({page,application},info)=>{
  await runtime(page,backend);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const navigations=[];
  await page.route(targets[backend],async route=>{navigations.push({url:route.request().url(),referer:route.request().headers().referer});await route.fulfill({contentType:'text/html',body:'<h1>本地拦截的游戏大厅</h1>'});});
  await page.goto('/?token=never-forward#private');await page.locator('#nickname').fill('返回大厅检查');await page.locator('#create').click();
  await expect(page.locator('.lobby-table')).toBeVisible();
  const room=[...application.contexts.values()].find(value=>value.controller.authority?.hostOnline());
  const originalId=room.controller.authority.record.hostId;
  const originalCount=application.contexts.size;
  page.once('dialog',async dialog=>{expect(dialog.message()).toContain('暂离房间，不会解散');expect(dialog.message()).toContain('30 分钟');await dialog.dismiss();});
  await page.locator('.room-lobby-link').click();
  await expect(page.locator('.lobby-table')).toBeVisible();expect(room.controller.authority.hostOnline()).toBe(true);
  await page.screenshot({path:info.outputPath(`${backend}-room-return.png`)});
  page.once('dialog',async dialog=>dialog.accept());await page.locator('.room-lobby-link').click();
  await expect(page).toHaveURL(targets[backend]);
  await expect.poll(()=>room.controller.authority.hostOnline()).toBe(false);
  expect(room.controller.authority.closed).toBe(false);
  expect(room.controller.authority.life.retentionDeadline).toBeGreaterThan(Date.now());
  expect(navigations).toEqual([{url:targets[backend],referer:undefined}]);
  await page.goto('/');await expect(page.locator('.lobby-table')).toBeVisible();
  expect(room.controller.authority.record.hostId).toBe(originalId);expect(room.controller.authority.hostOnline()).toBe(true);
  expect(application.contexts.size).toBe(originalCount);expect(errors).toEqual([]);
});

test('返回大厅前显式保存练习的十分钟离开期限',async({page,context})=>{
  await runtime(page,'aliyun');await page.goto('/');await page.locator('#nickname').fill('练习检查');await page.locator('#practice').click();
  await expect(page.locator('.lobby-table')).toBeVisible();
  await page.route(targets.aliyun,route=>route.fulfill({body:'<h1>本地大厅</h1>',contentType:'text/html'}));
  page.once('dialog',async dialog=>{expect(dialog.message()).toContain('暂离练习');expect(dialog.message()).toContain('10 分钟');await dialog.accept();});
  const before=Date.now();await page.locator('.room-lobby-link').click();await expect(page).toHaveURL(targets.aliyun);
  const storage=await context.storageState();
  const original=storage.origins.find(origin=>origin.origin==='http://127.0.0.1:3196');
  const saved=JSON.parse(original.localStorage.find(item=>item.name==='wizard-practice-save:aliyun').value);
  expect(saved.leftAt).toBeGreaterThanOrEqual(before);expect(saved.leftAt).toBeLessThanOrEqual(Date.now());
  await page.goto('/');await expect(page.locator('.lobby-table')).toBeVisible();
});

test('房主离线保留倒计时持续更新，过期后显示服务端关闭并禁止旧身份复活',async({page,browser,application},info)=>{
  await runtime(page,'aliyun');await page.goto('/');await page.locator('#nickname').fill('房主检查');await page.locator('#create').click();
  await expect(page.locator('.lobby-table')).toBeVisible();
  const room=[...application.contexts.values()].find(value=>value.controller.authority?.hostOnline());
  const guestContext=await browser.newContext({viewport:{width:390,height:844}});const guest=await guestContext.newPage();
  try {
    await runtime(guest,'aliyun');await guest.goto(`/?room=A-${room.id}`);await guest.locator('#nickname').fill('在线客人');
    await guest.locator('#join').click();await expect(guest.locator('.lobby-table')).toBeVisible();
    await page.close();await expect.poll(()=>room.controller.authority.hostOnline()).toBe(false);
    const deadline=Date.now()+65000;
    await room.execute(async()=>{room.controller.authority.life.retentionDeadline=deadline;await room.controller.persistAndPublish(room.id);});
    await expect(guest.locator('#retention-countdown')).toContainText('1 分');
    const previous=await guest.locator('#retention-countdown').textContent();
    await expect.poll(()=>guest.locator('#retention-countdown').textContent()).not.toBe(previous);
    await expect(guest.locator('.lifecycle-banner')).toContainText('续赛投票，否则关闭');
    for(const size of [{width:390,height:844},{width:844,height:390},{width:1440,height:900}]) {
      await guest.setViewportSize(size);expect(await guest.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
      await guest.screenshot({path:info.outputPath(`retention-${size.width}.png`)});
    }
    await room.execute(async()=>{room.controller.authority.life.retentionDeadline=Date.now()-1;await room.controller.alarm();});
    await expect(guest.locator('.home-menu')).toBeVisible();await expect(guest.locator('#notice')).toContainText('保留期限已到');
    expect(room.record.closed).toBe(true);expect(room.record.authority.game.players).toEqual([]);
    await guest.goto(`/?room=A-${room.id}`);await guest.locator('#nickname').fill('原身份返回');await guest.locator('#join').click();
    await expect(guest.locator('#notice')).toContainText('房间已关闭');await expect(guest.locator('.lobby-table')).toHaveCount(0);
    expect(room.record.closed).toBe(true);
  } finally {await guestContext.close();}
});
