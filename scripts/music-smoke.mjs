import { chromium, expect } from '@playwright/test';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const base = process.env.GAME_URL || 'http://127.0.0.1:5173/';
try {
  const context = await browser.newContext();
  await context.addInitScript(() => {
    localStorage.setItem('wizard-music-volume', '0');
    const NativeAudio = window.AudioContext;
    window.__musicContexts = [];
    window.AudioContext = class extends NativeAudio {
      constructor(...args) { super(...args); window.__musicContexts.push(this); }
    };
  });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base);
  expect(await page.evaluate(() => window.__musicContexts.length)).toBe(0);
  await page.locator('#quick-settings > summary').click();
  await expect(page.locator('#music-toggle')).toHaveAttribute('data-status', 'muted');
  expect(await page.evaluate(() => window.__musicContexts.length)).toBe(0);
  await page.locator('#music-toggle').click();
  await expect(page.locator('#music-toggle')).toHaveAttribute('data-status', 'playing');
  await page.locator('#music-toggle').click();
  await expect(page.locator('#music-toggle')).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(() => page.evaluate(() => window.__musicContexts[0].state)).toBe('suspended');
  await expect(page.locator('#music-panel, #music-volume')).toHaveCount(0);
  await page.locator('#music-toggle').click();
  await expect(page.locator('#music-toggle')).toHaveAttribute('data-status', 'playing');
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(() => page.evaluate(() => window.__musicContexts[0].state)).toBe('suspended');
  await page.evaluate(() => {
    delete document.hidden;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.locator('#music-toggle')).toHaveAttribute('data-status', 'playing');
  await page.locator('#quick-settings > summary').click();
  await page.locator('#practice').click();
  await page.locator('#start').click();
  expect(await page.evaluate(() => window.__musicContexts.length)).toBe(1);
  await page.locator('#table-menu').click();
  await expect(page.locator('#music-toggle')).toHaveAttribute('data-status', 'playing');
  await page.locator('#music-toggle').click();
  await page.reload();
  await page.locator('.table').waitFor();
  await page.locator('#table-menu').click();
  await expect(page.locator('#music-toggle')).toContainText('播放音乐');
  expect(await page.evaluate(() => window.__musicContexts.length)).toBe(0);
  await page.locator('#music-toggle').click();
  await expect(page.locator('#music-toggle')).toHaveAttribute('data-status', 'playing');
  // Render the complete score offline to check actual PCM output, not just controls.
  const audio = await page.evaluate(async () => {
    const { scheduleBar, BEAT } = await import('/src/music.js');
    const ctx = new OfflineAudioContext(2, Math.ceil((16 * 4 * BEAT + 6) * 22050), 22050);
    const gain = ctx.createGain(); gain.gain.value = 4; gain.connect(ctx.destination);
    for (let bar = 0; bar < 16; bar++) scheduleBar(ctx, gain, bar, bar * 4 * BEAT);
    const result = await ctx.startRendering();
    let peak = 0, energy = 0, finite = true;
    for (const value of result.getChannelData(0)) {
      finite &&= Number.isFinite(value);
      peak = Math.max(peak, Math.abs(value)); energy += value * value;
    }
    return { peak, rms: Math.sqrt(energy / result.length), finite, duration: result.duration };
  });
  expect(audio.finite).toBe(true);
  expect(audio.peak).toBeGreaterThan(.02);
  expect(audio.peak).toBeLessThan(.8);
  expect(audio.rms).toBeGreaterThan(.005);
  expect(errors).toEqual([]);
  console.log(JSON.stringify({ playback: 'direct pause/resume, no volume slider, persisted preference, visibility, one context across scenes', audio, errors }));
} finally { await browser.close(); }
