import { test, expect } from './fixtures.js';
import { mockDirection, openControls } from './direction-fixture.js';

const calls = page => page.evaluate(() => window.__direction.calls);
const button = control => control.locator('[data-screen-direction]');
const hint = control => control.locator('[data-landscape-help]');

test('一次触摸直接全屏再横屏；再次触摸恢复自动旋转，无方向弹窗', async ({ page }, info) => {
  await mockDirection(page); const control = await openControls(page);
  expect(await calls(page)).toEqual([]);
  await expect(button(control)).toHaveText('横屏');
  await button(control).tap();
  await expect(button(control)).toHaveText('退出横屏');
  await expect(button(control)).toHaveAttribute('aria-busy', 'false');
  expect(await calls(page)).toEqual(['fullscreen', 'lock:landscape']);
  await page.setViewportSize({width:844,height:390});
  await page.screenshot({path:info.outputPath('landscape-active.png')});
  await expect(page.locator('dialog.screen-direction, #direction-fullscreen, [data-direction="portrait"]')).toHaveCount(0);
  await button(control).tap();
  await expect(button(control)).toHaveText('横屏');
  expect(await calls(page)).toEqual(['fullscreen', 'lock:landscape', 'unlock', 'exit']);
  expect(await page.evaluate(() => document.fullscreenElement)).toBeNull();
});

for (const mode of ['no-orientation', 'unsupported', 'no-fullscreen', 'disabled-fullscreen']) {
  test(`${mode} 只显示简短手动旋转提示，不显示无效按钮`, async ({ page }, info) => {
    await mockDirection(page, mode); const control = await openControls(page);
    await expect(button(control)).toBeHidden();
    await expect(hint(control)).toContainText('关闭系统竖屏锁定后手动旋转手机');
    await expect(hint(control)).toBeVisible();
    if(mode==='unsupported')await page.screenshot({path:info.outputPath('manual-rotation.png')});
    for (const [width, height] of [[844, 390], [390, 844], [667, 375]]) await page.setViewportSize({ width, height });
    expect(await calls(page)).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  });
}

for (const mode of ['rejected', 'fullscreen-rejected']) {
  test(`${mode} 自动恢复本次状态并改为手动旋转提示`, async ({ page }) => {
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await mockDirection(page, mode); const control = await openControls(page);
    await button(control).tap();
    await expect(button(control)).toBeHidden();
    await expect(hint(control)).toContainText('浏览器未能开启横屏');
    expect(await calls(page)).toEqual(mode === 'rejected' ? ['fullscreen', 'lock:landscape', 'unlock', 'exit'] : ['fullscreen']);
    expect(await page.evaluate(() => document.fullscreenElement)).toBeNull();
    expect(errors).toEqual([]);
  });
}

test('自行旋转、键盘高度和连续进出均不隐式请求 API', async ({ page }) => {
  await mockDirection(page); const control = await openControls(page);
  for (const [width, height] of [[844, 390], [390, 844], [390, 300], [667, 375], [390, 844]]) await page.setViewportSize({ width, height });
  expect(await calls(page)).toEqual([]);
  for (let i = 0; i < 3; i++) {
    await button(control).tap();
    await expect(button(control)).toHaveAttribute('aria-busy', 'false');
    await page.setViewportSize({ width: 844, height: 390 });
    await button(control).tap();
    await expect(button(control)).toHaveText('横屏');
    await page.setViewportSize({ width: 390, height: 844 });
  }
  expect(await calls(page)).toEqual(Array(3).fill(['fullscreen', 'lock:landscape', 'unlock', 'exit']).flat());
});

test('原有全屏在退出横屏后保留；原有全屏被外部关闭会解除本次锁定', async ({ page }) => {
  await mockDirection(page); const control = await openControls(page);
  await page.evaluate(() => window.__direction.existing());
  await button(control).tap(); await expect(button(control)).toHaveAttribute('aria-busy', 'false');
  await button(control).tap(); await expect(button(control)).toHaveText('横屏');
  expect(await calls(page)).toEqual(['lock:landscape', 'unlock']);
  expect(await page.evaluate(() => document.fullscreenElement === document.documentElement)).toBe(true);
  await button(control).tap(); await expect(button(control)).toHaveAttribute('aria-busy', 'false');
  await page.evaluate(() => window.__direction.leave());
  await expect(button(control)).toHaveText('横屏');
  expect(await calls(page)).toEqual(['lock:landscape', 'unlock', 'lock:landscape', 'unlock']);
});

for (const action of ['leave', 'replace']) {
  test(`浏览器 ${action} 全屏时恢复控件且不退出其他元素的全屏`, async ({ page }) => {
    await mockDirection(page); const control = await openControls(page);
    await button(control).tap(); await expect(button(control)).toHaveAttribute('aria-busy', 'false');
    await page.evaluate(action => window.__direction[action](), action);
    await expect(button(control)).toHaveText('横屏');
    expect(await calls(page)).toEqual(['fullscreen', 'lock:landscape', 'unlock']);
    expect(await page.evaluate(() => window.__direction.locked)).toBe(false);
  });
}

for (const mode of ['pending-lock', 'pending-fullscreen']) {
  test(`${mode} 连点取消后迟到的请求也会清理，不重新锁屏`, async ({ page }) => {
    await mockDirection(page, mode); const control = await openControls(page);
    // Two immediate clicks must cancel, not start a second request.
    await button(control).evaluate(node => { node.click(); node.click(); });
    if (mode === 'pending-lock') {
      // The first two clicks cancel while fullscreen is still resolving.
      await expect(button(control)).toHaveText('横屏');
      await button(control).tap();
      await expect.poll(async () => (await calls(page)).filter(call => call === 'lock:landscape').length).toBe(1);
      await button(control).tap();
      await page.evaluate(() => window.__direction.finishLock());
    } else await page.evaluate(() => window.__direction.finishFullscreen());
    await expect(button(control)).toHaveText('横屏');
    expect((await calls(page)).filter(call => call === 'fullscreen')).toHaveLength(mode === 'pending-lock' ? 2 : 1);
    expect(await page.evaluate(() => window.__direction.locked)).toBe(false);
    expect(await page.evaluate(() => document.fullscreenElement)).toBeNull();
  });
}

test('全屏期间未完成的方向锁定在浏览器退出后不会重新生效', async ({ page }) => {
  await mockDirection(page, 'pending-lock'); const control = await openControls(page);
  await button(control).tap();
  await expect.poll(async () => (await calls(page)).includes('lock:landscape')).toBe(true);
  await page.evaluate(() => { window.__direction.leave(); window.__direction.finishLock(); });
  await expect(button(control)).toHaveText('横屏');
  expect(await page.evaluate(() => window.__direction.locked)).toBe(false);
  expect((await calls(page)).filter(call => call.startsWith('lock:'))).toHaveLength(1);
});

test('退出失败仍解除锁定并保留重试按钮，不丢失全屏所有权', async ({ page }) => {
  await mockDirection(page, 'exit-rejected'); const control = await openControls(page);
  await button(control).tap(); await expect(button(control)).toHaveAttribute('aria-busy', 'false');
  await button(control).tap();
  await expect(hint(control)).toContainText('浏览器的退出全屏操作');
  await expect(button(control)).toHaveText('退出横屏');
  expect(await page.evaluate(() => window.__direction.locked)).toBe(false);
  await page.evaluate(() => { window.__direction.mode = 'success'; });
  await button(control).tap(); await expect(button(control)).toHaveText('横屏');
  expect(await calls(page)).toEqual(['fullscreen', 'lock:landscape', 'unlock', 'exit', 'exit']);
});

test('页面离开释放本次横屏，回来或旋转不自动再申请', async ({ page }) => {
  await mockDirection(page); const control = await openControls(page);
  await button(control).tap(); await expect(button(control)).toHaveAttribute('aria-busy', 'false');
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await expect(button(control)).toHaveText('横屏');
  await page.evaluate(() => window.dispatchEvent(new Event('pageshow')));
  await page.setViewportSize({ width: 844, height: 390 });
  expect(await calls(page)).toEqual(['fullscreen', 'lock:landscape', 'unlock', 'exit']);
});

test('退出请求失败后浏览器自行退出也会恢复按钮', async ({ page }) => {
  await mockDirection(page, 'exit-rejected'); const control = await openControls(page);
  await button(control).tap(); await expect(button(control)).toHaveAttribute('aria-busy', 'false');
  await button(control).tap(); await expect(hint(control)).toContainText('重试退出横屏');
  await page.evaluate(() => window.__direction.leave());
  await expect(button(control)).toHaveText('横屏');
  await expect(hint(control)).toBeHidden();
  expect(await calls(page)).toEqual(['fullscreen', 'lock:landscape', 'unlock', 'exit']);
});

test('桌面引擎原生全屏与模态菜单共存；方向锁仍为替身', async ({ page }) => {
  await mockDirection(page, 'native-fullscreen'); const control = await openControls(page);
  test.skip(!await page.evaluate(() => document.fullscreenEnabled && typeof document.documentElement.requestFullscreen === 'function'), '此引擎的移动模拟上下文未提供原生全屏');
  await control.evaluate(node => {
    const menu=document.createElement('dialog');menu.id='native-menu-fixture';
    menu.append(node.cloneNode(true));document.body.append(menu);menu.showModal();
  });
  const menu=page.locator('#native-menu-fixture');
  await menu.locator('[data-screen-direction]').tap();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement === document.documentElement)).toBe(true);
  await expect(menu.locator('[data-screen-direction]')).toHaveAttribute('aria-busy', 'false');
  await expect(menu).toBeVisible();
  await menu.locator('[data-screen-direction]').tap();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement)).toBeNull();
  expect(await calls(page)).toEqual(['lock:landscape','unlock']);
});

test('未替换浏览器 API 的页面保留自动布局且没有方向设置弹窗', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const control = await openControls(page);
  await page.setViewportSize({ width: 844, height: 390 }); await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('dialog.screen-direction')).toHaveCount(0);
  if (await button(control).isHidden()) await expect(hint(control)).toContainText('手动旋转手机');
  expect(await page.evaluate(() => document.fullscreenElement)).toBeNull();
  expect(errors).toEqual([]);
});
