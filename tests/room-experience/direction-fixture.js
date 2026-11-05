// Browser API substitutes verify lifecycle and ownership, not a real phone's
// fullscreen permissions, system orientation setting or on-screen keyboard.
export async function mockDirection(page, mode = 'success') {
  await page.addInitScript(mode => {
    let fullscreen = null, finishLock, finishFullscreen;
    const calls = [], orientation = new EventTarget();
    const api = {
      calls, mode, locked: false,
      finishLock: () => finishLock?.(), finishFullscreen: () => finishFullscreen?.(),
      existing: () => { fullscreen = document.documentElement; },
      leave: () => { fullscreen = null; document.dispatchEvent(new Event('fullscreenchange')); },
      replace: () => { fullscreen = document.body; document.dispatchEvent(new Event('fullscreenchange')); },
    };
    Object.assign(orientation, {
      type: 'portrait-primary',
      unlock() { calls.push('unlock'); api.locked = false; },
      lock: mode === 'unsupported' ? undefined : async direction => {
        calls.push(`lock:${direction}`);
        if (api.mode === 'rejected') throw new DOMException('Denied', 'SecurityError');
        if (api.mode === 'pending-lock') await new Promise(resolve => { finishLock = resolve; });
        api.locked = true;
      },
    });
    Object.defineProperty(screen, 'orientation', { configurable: true, value: mode === 'no-orientation' ? undefined : orientation });
    if (mode === 'native-fullscreen') { window.__direction = api; return; }
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => fullscreen });
    Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: mode !== 'disabled-fullscreen' });
    Element.prototype.requestFullscreen = mode === 'no-fullscreen' ? undefined : async function () {
      calls.push('fullscreen');
      if (api.mode === 'fullscreen-rejected') throw new DOMException('Denied', 'NotAllowedError');
      if (api.mode === 'pending-fullscreen') await new Promise(resolve => { finishFullscreen = resolve; });
      fullscreen = this; document.dispatchEvent(new Event('fullscreenchange'));
    };
    document.exitFullscreen = async () => {
      calls.push('exit');
      if (api.mode === 'exit-rejected') throw new Error('Exit denied');
      fullscreen = null; document.dispatchEvent(new Event('fullscreenchange'));
    };
    window.__direction = api;
  }, mode);
}

export async function openControls(page, navigate = true) {
  if (navigate) await page.goto('/');
  const control = page.locator('[data-landscape-control]').last();
  await control.waitFor({ state: 'attached' });
  if (await page.locator('#quick-settings').count()) {
    if (!await page.locator('#quick-settings').evaluate(node => node.open)) await page.locator('#quick-settings > summary').tap();
    await page.locator('.settings-content').waitFor({ state: 'visible' });
  }
  return control;
}

export async function landscapeCycle(page, control) {
  await control.locator('[data-screen-direction]').tap();
  await page.setViewportSize({ width: 844, height: 390 });
  await control.locator('[data-screen-direction]').tap();
  await page.setViewportSize({ width: 390, height: 844 });
}
