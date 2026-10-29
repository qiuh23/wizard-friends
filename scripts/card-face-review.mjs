import { chromium, expect } from '@playwright/test';
import fs from 'node:fs';
import { createGame, addPlayer, act, viewFor } from '../src/game.js';
import { createRandomStream } from '../src/random.js';
import { DEFAULT_OPTIONS } from '../src/rules-options.js';

// Local/manual regression for the detached-number report. No production hooks.
const base = process.env.GAME_URL || 'http://127.0.0.1:5173/';
const out = 'output/playwright'; fs.mkdirSync(out, { recursive: true });
const errors = [], checks = [];
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'chrome', headless: true });

function fixture() {
  for (let seed = 1; seed <= 20; seed++) {
    const game = createGame(); game.randomState = createRandomStream(Array(11).fill(seed));
    for (let i = 0; i < 6; i++) addPlayer(game, `p${i}`, ['青岚', '云舒', '风行', '清月', '星河', '林语'][i], i > 0);
    act(game, 'p0', { type: 'start', options: DEFAULT_OPTIONS });
    for (let step = 0; step < 3000 && game.round <= 9; step++) {
      if (game.phase === 'play' && game.round >= 4 && game.turn === 0 && game.trump === 'yellow'
        && game.players[0].hand.some(card => card.suit === 'yellow') && game.trick.length < 5) {
        game.turnDeadline = Date.now() + 30000;
        return { version: 1, role: 'practice', room: '离线练习', me: 'p0', game, identities: {} };
      }
      const player = game.players[game.turn], view = viewFor(game, player.id);
      if (game.phase === 'trump') act(game, player.id, { type: 'trump', suit: 'yellow' });
      else if (game.phase === 'bid') act(game, player.id, { type: 'bid', value: view.bids[0] });
      else if (game.phase === 'play') act(game, player.id, { type: 'play', card: view.legal[0] });
      else if (['trickEnd', 'roundEnd'].includes(game.phase)) act(game, 'p0', { type: 'next' });
      else throw Error(`Unexpected fixture phase: ${game.phase}`);
    }
  }
  throw Error('No legal yellow-trump fixture found');
}
const record = fixture();
async function openGame(width, height, webgl) {
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: width < 851, reducedMotion: 'no-preference' });
  await context.addInitScript(({ record, webgl }) => {
    sessionStorage.setItem('wizard-room-session', JSON.stringify(record));
    localStorage.setItem('wizard-low-graphics', 'true');
    localStorage.setItem('wizard-trump-motion', 'false');
    if (!webgl) {
      const get = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (kind, ...args) {
        return kind.startsWith('webgl') ? null : get.call(this, kind, ...args);
      };
    }
  }, { record, webgl });
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.goto(base); await page.locator('.hand .card').first().waitFor();
  if (webgl) await expect(page.locator('body')).toHaveClass(/has-webgl/);
  else await expect(page.locator('#graphics')).toHaveText(/2D/);
  return { context, page };
}

try {
  for (const webgl of [true, false]) for (const [width, height] of [[1440, 900], [390, 844], [844, 390]]) {
    const { context, page } = await openGame(width, height, webgl);
    const yellow = page.locator('.hand .card.yellow').first();
    await yellow.click({ position: { x: 12, y: 40 } });
    await expect(page.locator('.hand .card.selected')).toHaveClass(/yellow/);
    await expect(yellow.locator('.corner small')).toHaveText('✧');
    await expect(page.locator('.card-suit')).toHaveCount(0);
    const onFace = await yellow.locator('.corner').innerText();
    expect(onFace).not.toMatch(/蓝|红|绿|黄/);
    const before = await yellow.evaluate(el => el.style.getPropertyValue('--card-color'));
    expect(before).toBe('#f3cf66');
    const sides = await page.locator('.trump-card-face').evaluateAll(faces => faces.map(face => ({
      art: face.style.backgroundImage, mark: face.textContent, color: face.style.getPropertyValue('--card-color'),
    })));
    expect(sides).toHaveLength(2); expect(sides[0]).toEqual(sides[1]);
    await page.screenshot({ path: `${out}/card-clarity-${webgl ? '3d' : '2d'}-${width}.png` });
    await page.locator('#cancel-card').click();
    const legal = page.locator('.hand .card.playable').first();
    await legal.click({ position: { x: 12, y: 40 } });
    await page.locator('#confirm-play').click();
    await expect(page.locator('.played .card').first()).toBeAttached();
    for (const delay of [0, 100, 300, 900]) {
      if (delay) await page.waitForTimeout(delay);
      const marks = await page.locator('.played .card .corner').evaluateAll(nodes => nodes.map(el => getComputedStyle(el).visibility));
      expect(marks.length).toBeGreaterThan(0);
      expect(marks.every(value => value === (webgl ? 'hidden' : 'visible'))).toBe(true);
    }
    await page.waitForFunction(() => ['trickEnd', 'roundEnd', 'finished'].includes(document.body.dataset.phase));
    const labels = await page.locator('.played > small').evaluateAll(nodes => nodes.map(node => {
      const name = node.querySelector('.played-name').getBoundingClientRect();
      const state = node.querySelector('.played-state').getBoundingClientRect();
      return { nameY: name.y + name.height / 2, stateY: state.y + state.height / 2, state: node.querySelector('.played-state').textContent };
    }));
    expect(labels.some(label => label.state === '赢墩')).toBe(true);
    for (const label of labels) expect(Math.abs(label.nameY - label.stateY)).toBeLessThanOrEqual(2);
    await page.screenshot({ path: `${out}/card-labels-${webgl ? '3d' : '2d'}-${width}.png` });
    checks.push({ width, height, graphics: webgl ? '3D' : '2D', identicalTrumpFaces: true, noDetachedMarks: true, singleLineLabels: true });
    await context.close();
  }

  // Inspect the actual renderer: the reverse face and printed marks must share
  // the same texture even while the physical card moves and rotates.
  const context = await browser.newContext({ viewport: { width: 960, height: 640 }, reducedMotion: 'no-preference' });
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.route('**/__card_face_review__', route => route.fulfill({ contentType: 'text/html',
    body: '<style>body{margin:0;background:#10291f}#table{width:960px;height:640px}canvas{display:block}</style><div id="table"></div>' }));
  await page.goto(new URL('__card_face_review__', base).href);
  await page.evaluate(async () => {
    const { TableScene } = await import('/src/table-scene.js');
    window.reviewScene = new TableScene(); window.reviewScene.trumpMotion = false;
    window.reviewScene.attach(document.querySelector('#table'), { phase: 'bid', options: {}, round: 1, completedTricks: 0,
      trump: 'yellow', reveal: { id: 'yellow-9', kind: 'number', suit: 'yellow', rank: 9 }, trick: [] });
  });
  await page.waitForFunction(() => window.reviewScene.trumpFace.material.map?.image instanceof HTMLCanvasElement);
  const texture = await page.evaluate(() => {
    const scene = window.reviewScene, face = scene.trumpFace.material, reverse = scene.trumpBackFace.material;
    const ctx = face.map.image.getContext('2d');
    const whitePixels = ctx.getImageData(18, 30, 130, 95).data.filter((value, i) => i % 4 === 0 && value > 220).length;
    return { shared: face.map === reverse.map, unlit: face.isMeshBasicMaterial && !face.toneMapped,
      border: [...ctx.getImageData(4, 240, 1, 1).data], oppositeBorder: [...ctx.getImageData(315, 240, 1, 1).data], whitePixels };
  });
  expect(texture.shared).toBe(true); expect(texture.unlit).toBe(true);
  expect(texture.border).toEqual([243, 207, 102, 255]); expect(texture.oppositeBorder).toEqual([243, 207, 102, 255]);
  expect(texture.whitePixels).toBeGreaterThan(500);
  for (const [side, angle] of [['front', 0], ['reverse', Math.PI]]) {
    await page.evaluate(angle => {
      const scene = window.reviewScene; scene.paused = true; scene.trumpCard.rotation.y = angle;
      scene.renderer.render(scene.scene, scene.camera); scene.attach(null);
    }, angle);
    await page.screenshot({ path: `${out}/trump-yellow-${side}.png` });
    await page.evaluate(() => {
      const scene = window.reviewScene; scene.host = document.querySelector('#table');
    });
  }
  checks.push({ physicalTexture: texture });
  await context.close(); expect(errors).toEqual([]);
  console.log(JSON.stringify({ checks, errors }));
} finally { await browser.close(); }
