import {test,expect} from './fixtures.js';

async function mockDirection(page, mode) {
  await page.addInitScript(mode=>{
    let fullscreen=null;
    const calls=[],orientation=new EventTarget();
    let resolveLock;
    const api={calls,mode,finish:()=>resolveLock?.(),existing:()=>{fullscreen=document.documentElement;},leave:()=>{fullscreen=null;document.dispatchEvent(new Event('fullscreenchange'));}};
    Object.assign(orientation,{type:'portrait-primary',unlock(){calls.push('unlock');},lock:mode==='unsupported'?undefined:async direction=>{
      calls.push(`lock:${direction}`);
      if(api.mode==='rejected')throw new DOMException('Denied','SecurityError');
      if(api.mode==='pending')await new Promise(resolve=>{resolveLock=resolve;});
    }});
    Object.defineProperty(screen,'orientation',{configurable:true,value:orientation});
    Object.defineProperty(document,'fullscreenElement',{configurable:true,get:()=>fullscreen});
    Object.defineProperty(document,'fullscreenEnabled',{configurable:true,value:true});
    Element.prototype.requestFullscreen=async function(){calls.push('fullscreen');if(api.mode==='fullscreen-rejected')throw new DOMException('Denied','NotAllowedError');fullscreen=this;document.dispatchEvent(new Event('fullscreenchange'));};
    document.exitFullscreen=async()=>{calls.push('exit');if(api.mode==='exit-rejected')throw new Error('Exit denied');fullscreen=null;document.dispatchEvent(new Event('fullscreenchange'));};
    window.__direction=api;
  },mode);
}
async function open(page) {
  await page.goto('/');
  const trigger=page.locator('[data-screen-direction]');
  await expect(trigger).toHaveCount(1);
  if(!await trigger.isVisible())await page.locator('#quick-settings > summary').click();
  await trigger.click();
  await expect(page.locator('dialog.screen-direction')).toBeVisible();
  await expect(page.locator('dialog.screen-direction')).toHaveCount(1);
}
const calls=page=>page.evaluate(()=>window.__direction.calls);

test('方向控制只响应点击；横竖屏锁定与恢复不自动全屏',async({page})=>{
  await mockDirection(page,'success');await open(page);
  expect(await calls(page)).toEqual([]);
  await page.getByRole('button',{name:'尝试横屏',exact:true}).click();
  await expect(page.locator('[data-direction-status]')).toContainText('已请求锁定横屏');
  expect(await calls(page)).toEqual(['lock:landscape']);
  await page.getByRole('button',{name:'尝试竖屏',exact:true}).click();
  await expect(page.locator('[data-direction-status]')).toContainText('已请求锁定竖屏');
  await page.locator('[data-direction-reset]').click();
  expect(await calls(page)).toEqual(['lock:landscape','lock:portrait','unlock']);
  await page.keyboard.press('Escape');await expect(page.locator('dialog.screen-direction')).not.toBeVisible();
});
test('不支持方向 API 时给出手动旋转提示，页面继续可用',async({page})=>{
  await mockDirection(page,'unsupported');await open(page);
  await expect(page.locator('[data-direction-status]')).toContainText('请手动旋转手机');
  await expect(page.getByRole('button',{name:'尝试横屏',exact:true})).toBeDisabled();
  expect(await calls(page)).toEqual([]);
  await page.locator('[data-direction-close]').click();await page.setViewportSize({width:844,height:390});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('拒绝锁定不会擅自请求全屏；全屏后锁定失败会退出本次全屏',async({page})=>{
  await mockDirection(page,'rejected');await open(page);
  await page.getByRole('button',{name:'尝试横屏',exact:true}).click();
  await expect(page.locator('[data-direction-status]')).toContainText('未能锁定方向');
  expect(await calls(page)).toEqual(['lock:landscape','unlock']);
  await page.locator('#direction-fullscreen').check();await page.getByRole('button',{name:'尝试横屏',exact:true}).click();
  await expect(page.locator('[data-direction-status]')).toContainText('请手动旋转手机');
  expect(await calls(page)).toEqual(['lock:landscape','unlock','fullscreen','lock:landscape','unlock','exit']);
  expect(await page.evaluate(()=>document.fullscreenElement)).toBeNull();
});
test('全屏被拒绝时不锁定；成功后可以恢复并退出',async({page})=>{
  await mockDirection(page,'fullscreen-rejected');await open(page);
  await page.locator('#direction-fullscreen').check();await page.getByRole('button',{name:'尝试横屏',exact:true}).click();
  await expect(page.locator('[data-direction-status]')).toContainText('未能锁定方向');
  expect(await calls(page)).toEqual(['fullscreen','unlock']);
  await page.evaluate(()=>{window.__direction.mode='success';});
  await page.getByRole('button',{name:'尝试竖屏',exact:true}).click();
  await expect(page.locator('[data-direction-status]')).toContainText('已请求锁定竖屏');
  await page.locator('[data-direction-reset]').click();
  expect(await calls(page)).toEqual(['fullscreen','unlock','fullscreen','lock:portrait','unlock','exit']);
});
test('连续点击和旋转不重复请求，退出全屏取消尚未完成的锁定',async({page})=>{
  await mockDirection(page,'pending');await open(page);
  await page.locator('#direction-fullscreen').check();
  await page.locator('[data-direction="landscape"]').evaluate(button=>{button.click();button.click();});
  await expect(page.getByRole('button',{name:'尝试横屏',exact:true})).toBeDisabled();
  for(const [width,height] of [[844,390],[390,844],[667,375],[390,844]])await page.setViewportSize({width,height});
  expect(await calls(page)).toEqual(['fullscreen','lock:landscape']);
  await page.evaluate(()=>{window.__direction.leave();window.__direction.finish();});
  await expect(page.getByRole('button',{name:'尝试横屏',exact:true})).toBeEnabled();
  expect((await calls(page)).filter(value=>value.startsWith('lock:'))).toHaveLength(1);
  await expect(page.locator('[data-direction-status]')).toContainText('已退出全屏');
});
test('恢复操作保留用户原有全屏；退出本次全屏失败时仍能重试',async({page})=>{
  await mockDirection(page,'success');await open(page);
  await page.evaluate(()=>window.__direction.existing());await page.locator('#direction-fullscreen').check();
  await page.getByRole('button',{name:'尝试横屏',exact:true}).click();await page.locator('[data-direction-reset]').click();
  expect(await calls(page)).toEqual(['lock:landscape','unlock']);
  await page.evaluate(()=>{window.__direction.leave();window.__direction.mode='exit-rejected';});
  await page.getByRole('button',{name:'尝试横屏',exact:true}).click();await page.locator('[data-direction-reset]').click();
  await expect(page.locator('[data-direction-status]')).toContainText('浏览器的退出全屏操作');
  await expect(page.locator('[data-direction-reset]')).toBeEnabled();
  await page.evaluate(()=>{window.__direction.mode='success';});await page.locator('[data-direction-reset]').click();
  await expect(page.locator('[data-direction-status]')).toContainText('已恢复自动旋转');
  expect((await calls(page)).filter(value=>value==='fullscreen')).toHaveLength(1);
});
