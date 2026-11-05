import {test,expect} from './fixtures.js';
import {createGame,addPlayer,act,viewFor} from '../../src/game.js';
import {createRandomStream} from '../../src/random.js';
import {DEFAULT_OPTIONS} from '../../src/rules-options.js';

const sizes=[[390,844],[844,390],[390,844],[667,375],[375,667],[568,320],[320,568],[800,360],[360,800],[932,430],[430,932],[1440,900]];
const settle=page=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
async function fits(page,locator) {
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  if(locator)await expect.poll(()=>locator.evaluate(n=>{const r=n.getBoundingClientRect();return r.width>=40&&r.height>=40&&r.left>=0&&r.right<=innerWidth+1&&r.top>=0&&r.bottom<=innerHeight+1&&n.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));})).toBe(true);
}
test.beforeEach(async({page})=>{await page.addInitScript(()=>{for(const key of ['wizard-low-graphics:aliyun','wizard-trump-motion:aliyun','wizard-turn-sound:aliyun'])localStorage.setItem(key,key.includes('low')?'true':'false');});});

test('首页草稿与规则弹窗保留；房间沿用两个页签且旋转不重建连接',async({page,application},info)=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/');await page.locator('#nickname').fill('旋转巫师');await page.locator('#join-menu').click();await page.locator('#room-input').fill('A-ABCD2345');
  await page.locator('#rules').click();
  for(const [width,height] of sizes.slice(0,7)){await page.setViewportSize({width,height});await expect(page.locator('.modal')).toBeVisible();await fits(page);}
  await page.locator('#close-rules').click();await expect(page.locator('#nickname')).toHaveValue('旋转巫师');await expect(page.locator('#room-input')).toHaveValue('A-ABCD2345');await expect(page.locator('#join-form')).toBeVisible();
  let sockets=0;page.on('websocket',()=>sockets++);
  await page.locator('#create').click();await expect(page.locator('.lobby-table')).toBeVisible();
  await expect(page.locator('[data-lobby-panel="rules"]')).toHaveAttribute('aria-selected','true');
  await page.locator('input[name="predictionMode"][value="hidden"]').check();await page.locator('input[name="short"][value="true"]').check();
  await page.locator('#rule-extras>summary').click();await page.locator('input[name="foresight"][value="true"]').check();
  await expect(page.locator('#rule-extras')).toHaveAttribute('open','');
  await expect(page.locator('.lobby-current')).toContainText('隐藏预估');await expect(page.locator('.lobby-current')).toContainText('快速局');
  await page.locator('[data-lobby-panel="players"]').click();await page.locator('#bot-difficulty').selectOption('simple');await page.locator('#addbot').click();
  const beforeSockets=sockets,beforeRooms=application.contexts.size;
  await page.locator('#chat-toggle').click();await page.locator('#chat-input').fill('旋转中仍在输入');
  for(const [width,height] of sizes){await page.setViewportSize({width,height});await settle(page);await fits(page);await expect(page.locator('#chat-input')).toHaveValue('旋转中仍在输入');await expect(page.locator('[data-lobby-panel="players"]')).toHaveAttribute('aria-selected','true');await expect(page.locator('#bot-difficulty')).toHaveValue('simple');await expect(page.locator('#rule-extras')).toHaveAttribute('open','');}
  expect(sockets).toBe(beforeSockets);expect(application.contexts.size).toBe(beforeRooms);
  await page.locator('#close-chat').click();await page.setViewportSize({width:390,height:844});await page.screenshot({path:info.outputPath('compact-room-players.png')});
  await page.locator('[data-lobby-panel="rules"]').click();await expect(page.locator('input[name="predictionMode"][value="hidden"]')).toBeChecked();
  await page.screenshot({path:info.outputPath('compact-room-rules.png')});expect(errors).toEqual([]);
});

// Reach states through legal engine actions. Save only into this local test
// browser; no arbitrary-state endpoint or fixture hook is shipped to players.
function fixture(count,phase,round=10) {
  const game=createGame();game.randomState=createRandomStream(Array(11).fill(8));
  for(let i=0;i<count;i++)addPlayer(game,`p${i}`,['长昵称巫师一号','林间星光巫师','远帆探险巫师','云舒','星河','清月'][i]);
  act(game,'p0',{type:'start',options:DEFAULT_OPTIONS});
  for(let step=0;step<20000;step++){
    if(game.phase===phase&&(phase==='finished'||game.round>=round)&&(phase!=='play'||game.turn===0))return {version:1,role:'practice',room:'离线练习',me:'p0',game,identities:{}};
    const id=game.players[game.turn].id;
    if(game.phase==='trump')act(game,id,{type:'trump',suit:'yellow'});
    else if(game.phase==='bid')act(game,id,{type:'bid',value:viewFor(game,id).bids[0]});
    else if(game.phase==='play')act(game,id,{type:'play',card:viewFor(game,id).legal[0]});
    else if(['trickEnd','roundEnd'].includes(game.phase))act(game,'p0',{type:'next'});
    else throw Error(`Cannot reach ${phase}: ${game.phase}`);
  }
  throw Error('Fixture exhausted');
}
async function openFixture(page,record) {
  await page.addInitScript(record=>{record.game.turnDeadline=Date.now()+600000;sessionStorage.setItem('wizard-room-session:aliyun',JSON.stringify(record));},record);
  await page.goto('/');await expect(page.locator('.table')).toBeVisible();
}
async function selectCard(card) {
  await card.scrollIntoViewIfNeeded();
  const point=await card.evaluate(n=>{const r=n.getBoundingClientRect();for(const y of [15,30,45,8])for(const x of [4,8,15,r.width/2])if(n.contains(document.elementFromPoint(r.left+x,r.top+y)))return {x,y};return null;});
  expect(point).not.toBeNull();await card.click({position:point});
}
test('手牌、选中牌、出牌确认、记分与菜单经连续旋转保持且未误出牌',async({page},info)=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));await openFixture(page,fixture(6,'play',10));
  await selectCard(page.locator('.hand .playable').first());await expect(page.locator('.hand .selected')).toHaveCount(1);
  const selected=await page.locator('.hand .selected').getAttribute('data-card'),count=await page.locator('.hand .card').count();
  for(const [width,height] of sizes){
    await page.setViewportSize({width,height});await settle(page);await fits(page,page.locator('#confirm-play'));await expect(page.locator('.hand .selected')).toHaveAttribute('data-card',selected);await expect(page.locator('.hand .card')).toHaveCount(count);
    if([390,568,844].includes(width))await page.screenshot({path:info.outputPath(`selected-hand-${width}.png`)});
  }
  await page.locator('#table-scores').click();
  for(const [width,height] of sizes.slice(0,7)){await page.setViewportSize({width,height});await settle(page);await expect(page.locator('#table-score-panel')).toBeVisible();await fits(page,page.locator('.close-scores'));}
  await page.locator('.close-scores').click();await page.locator('#table-menu').click();await page.locator('[data-screen-direction]').click();
  await page.setViewportSize({width:844,height:390});await page.setViewportSize({width:390,height:844});await expect(page.locator('dialog.screen-direction')).toBeVisible();await page.locator('[data-direction-close]').click();
  await expect(page.locator('#table-menu-panel')).toBeVisible();await page.locator('#table-menu').click();await expect(page.locator('.hand .selected')).toHaveAttribute('data-card',selected);
  await page.locator('#confirm-play').click();await expect(page.locator('.hand .card')).toHaveCount(count-1);expect(errors).toEqual([]);
});

for(const phase of ['roundEnd','finished'])test(`${phase} 结算、明细展开与确认在短横屏可达且保留`,async({page},info)=>{
  await openFixture(page,fixture(3,phase,5));
  const detail=page.locator('.settlement-details');if(await detail.count())await detail.locator('summary').click();
  for(const [width,height] of [...sizes.slice(0,9),[568,250],[667,280]]){
    await page.setViewportSize({width,height});await settle(page);await fits(page);await expect(page.locator('.settlement-panel')).toBeVisible();
    if(await detail.count())await expect(detail).toHaveAttribute('open','');
    await fits(page,page.locator('.settlement-details-body'));
    const button=page.locator('.settlement-actions button').first();await button.scrollIntoViewIfNeeded();await fits(page,button);
    if(width===568)await page.screenshot({path:info.outputPath(`${phase}-short-landscape.png`)});
  }
});

test('安全区、视觉键盘和短高度收缩时聊天可操作且保留手牌选择',async({page},info)=>{
  await page.route(/\/assets\/.*\.css$/,async route=>{const response=await route.fetch();await route.fulfill({response,body:(await response.text()).replaceAll('env(safe-area-inset-left)','44px').replaceAll('env(safe-area-inset-right)','44px').replaceAll('env(safe-area-inset-bottom)','21px')});});
  await page.addInitScript(()=>{const viewport=new EventTarget();Object.assign(viewport,{height:844,offsetTop:0});Object.defineProperty(window,'visualViewport',{configurable:true,value:viewport});window.__keyboard=height=>{viewport.height=height;viewport.dispatchEvent(new Event('resize'));};});
  await openFixture(page,fixture(3,'play',10));await selectCard(page.locator('.hand .playable').first());const selected=await page.locator('.hand .selected').getAttribute('data-card');
  await page.locator('#chat-toggle').click();await page.locator('#chat-input').fill('键盘与旋转测试草稿');
  for(const [width,height,visual] of [[390,844,400],[844,390,210],[568,320,190],[320,568,270]]){
    await page.setViewportSize({width,height});await page.evaluate(h=>window.__keyboard(h),visual);await settle(page);
    await expect(page.locator('#chat-input')).toHaveValue('键盘与旋转测试草稿');await fits(page,page.locator('#chat-form button'));await expect(page.locator('.hand .selected')).toHaveAttribute('data-card',selected);
    if(width===568)await page.screenshot({path:info.outputPath('keyboard-safe-short.png')});
  }
});
