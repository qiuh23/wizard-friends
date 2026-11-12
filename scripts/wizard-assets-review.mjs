// Local/manual WebGL regression. No test globals ship in the application.
import fs from 'node:fs';
import { chromium, expect } from '@playwright/test';
import { createGame, addPlayer, act, viewFor } from '../src/game.js';
import { createRandomStream } from '../src/random.js';
import { DEFAULT_OPTIONS } from '../src/rules-options.js';

const base = process.env.GAME_URL || 'http://127.0.0.1:5173/';
const out = 'output/playwright/wizard-assets'; fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: true,
  ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : { channel: process.env.BROWSER_CHANNEL || 'chrome' }) });
const results = [], errors = [];
function fixture(count) {
  const game = createGame(); game.randomState = createRandomStream(Array(11).fill(14));
  for (let i = 0; i < count; i++) addPlayer(game, `p${i}`, ['青岚', '云舒', '风行', '清月', '星河', '林语'][i]);
  act(game, 'p0', { type: 'start', options: DEFAULT_OPTIONS });
  for (let i = 0; i < 20000; i++) {
    if (game.round >= 6 && game.phase === 'play' && game.trick.length === 0) break;
    const p = game.players[game.turn], view = viewFor(game, p.id);
    const action = game.phase === 'trump' ? { type: 'trump', suit: 'blue' } : game.phase === 'bid' ? { type: 'bid', value: view.bids[0] }
      : game.phase === 'play' ? { type: 'play', card: view.legal[0] } : { type: 'next' };
    act(game, ['trickEnd', 'roundEnd'].includes(game.phase) ? 'p0' : p.id, action);
  }
  for (let i = 0; i < count; i++) { const p = game.players[game.turn]; act(game, p.id, { type: 'play', card: viewFor(game, p.id).legal[0] }); }
  game.players.forEach(p => { p.bot = false; });
  return { version: 1, role: 'practice', room: '离线练习', me: 'p0', game, identities: {} };
}
async function open(width, height, count = 6, fail = false) {
  const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce' });
  if (count) await context.addInitScript(record => {
    const now = Date.now(); Date.now = () => now;
    record.game.turnDeadline = now + 45000; record.remainingMs = 45000;
    record.collection = { scope: `${record.game.round}:${record.game.completedTricks}`, at: now + 3000, remainingMs: null };
    record.game.events.forEach(e => { e.time = now - (e.type === 'trickEnd' ? 0 : 1000); });
    sessionStorage.setItem('wizard-room-session', JSON.stringify(record));
    localStorage.setItem('wizard-low-graphics', 'false');
  }, fixture(count));
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.route(/\/src\/table-scene\.js(?:\?|$)/, async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()).replace('this.buildTrump();', 'this.buildTrump();window.__wizardAssetsScene=this;') });
  });
  if (fail) await page.route('**/wizard_table_felt.glb', route => route.fulfill({ status: 404, body: 'Test missing asset' }));
  await page.goto(base); await page.waitForFunction(() => window.__wizardAssetsScene?.assets && document.body.classList.contains('has-webgl'));
  await page.evaluate(() => window.__wizardAssetsScene.assetLoad);
  return { context, page };
}
async function inspect(page) {
  return page.evaluate(async () => {
    const scene = window.__wizardAssetsScene, THREE = await import('/node_modules/three/build/three.module.js');
    scene.updateAssetLighting(); scene.renderer.render(scene.scene, scene.camera);
    let lights = 0, points = 0; scene.scene.traverseVisible(o => { if (o.isLight) lights++; if (o.isPointLight) points++; });
    const timings = [];
    for (let i = 0; i < 12; i++) { const start = performance.now(); scene.renderer.render(scene.scene, scene.camera); scene.renderer.getContext().finish(); timings.push(performance.now() - start); }
    const info = scene.renderer.info;
    return { status: scene.assets.status, calls: info.render.calls, triangles: info.render.triangles,
      memory: { ...info.memory, programs: info.programs.length }, lights, points, renderMilliseconds: timings,
      cardFaces: [...scene.cards.values()].map(g => ({ type: g.userData.face.material.type,
        toneMapped: g.userData.face.material.toneMapped, fog: g.userData.face.material.fog, y: g.userData.target.y })),
      flameError: scene.assets.candles?.map((c, i) => c.flame.getWorldPosition(new THREE.Vector3()).distanceTo(scene.assetLighting.points[i].getWorldPosition(new THREE.Vector3()))),
      orb: scene.assetLighting?.crystal && {
        transparent: scene.orb.material.transparent, transmission: scene.orb.material.transmission,
        depthWrite: scene.orb.material.depthWrite, core: Boolean(scene.orb.getObjectByName('OrbBlueCore')),
        poolY: scene.assetLighting.crystal.pool.position.y,
        sourceError: scene.orb.getWorldPosition(new THREE.Vector3()).distanceTo(scene.assetLighting.orbPoint.getWorldPosition(new THREE.Vector3())),
        pointVisible: scene.assetLighting.orbPoint.visible,
        lanternVisible: scene.scene.getObjectByName('WizardLantern').visible,
      },
      legacyOff: scene.legacyLights.every(light => !light.visible), layout: document.querySelector('.table')?.dataset.layoutMode,
      overflow: document.documentElement.scrollWidth > innerWidth + 1 };
  });
}
try {
  for (const [width, height, count] of [[1440,900,0],[1440,900,3],[1440,900,6],[390,844,6],[844,390,6],[667,300,6]]) {
    const { context, page } = await open(width, height, count);
    const result = await inspect(page); expect(result.status).toBe('ready'); expect(result.legacyOff).toBe(true);
    expect(result.points).toBeLessThanOrEqual(height > width || result.layout === 'strip' ? 2 : 4);
    expect(result.lights).toBeLessThanOrEqual(7); expect(result.overflow).toBe(false);
    expect(Math.max(...result.flameError)).toBeLessThan(1e-6);
    expect(result.orb).toMatchObject({ transparent: true, transmission: 0, depthWrite: false, core: true, poolY: .356 });
    expect(result.orb.sourceError).toBeLessThan(1e-6);
    const small = height > width || result.layout === 'strip' || width <= 600;
    expect(result.orb.pointVisible).toBe(!small); expect(result.orb.lanternVisible).toBe(!small);
    if (count) for (const face of result.cardFaces) { expect(face.type).toBe('MeshBasicMaterial'); expect(face.toneMapped).toBe(false); expect(face.fog).toBe(false); expect(face.y).toBe(.382); }
    await page.screenshot({ path: `${out}/${count ? `${count}-players` : 'hero'}-${width}x${height}.png` });
    const repeats = [];
    for (let i = 0; i < 6; i++) {
      await page.evaluate(i => { const s = window.__wizardAssetsScene; s.setLow(i % 2 === 0); s.resize(); }, i);
      repeats.push(await inspect(page));
    }
    expect(repeats.at(-1).memory).toEqual(repeats[1].memory);
    expect(repeats.filter((_, i) => i % 2 === 0).every(r => r.points <= 2 && r.lights <= 4)).toBe(true);
    results.push({ width, height, count, ...result, repeatedQuality: repeats.map(r => ({ points: r.points, memory: r.memory })) });
    await context.close();
  }
  const { context, page } = await open(1440, 900, 6, true);
  expect((await inspect(page)).status).toBe('fallback');
  expect(await page.evaluate(() => window.__wizardAssetsScene.legacyLights.every(light => light.visible))).toBe(true);
  await page.unroute('**/wizard_table_felt.glb');
  expect(await page.evaluate(() => window.__wizardAssetsScene.assets.load())).toBe(true);
  expect((await inspect(page)).legacyOff).toBe(true);
  const loaded = await page.evaluate(async () => {
    const { GLTFLoader } = await import('/node_modules/three/examples/jsm/loaders/GLTFLoader.js');
    const { disposeObjectResources } = await import('/src/rendering/wizard-assets.mjs');
    const manifest = await (await fetch('/assets/wizard-v4/manifest.json')).json(), loader = new GLTFLoader();
    const gltfs = await Promise.all(manifest.assets.map(asset => loader.loadAsync(`/assets/wizard-v4/${asset.file}`)));
    const result = gltfs.map(gltf => { let lights = 0, cameras = 0; gltf.scene.traverse(o => { if (o.isLight) lights++; if (o.isCamera) cameras++; }); return { lights, cameras }; });
    disposeObjectResources(gltfs.map(gltf => gltf.scene)); return result;
  });
  expect(loaded).toHaveLength(16); expect(loaded.every(x => !x.lights && !x.cameras)).toBe(true);
  // Same context recovery must reuse the existing rig rather than creating more.
  await page.evaluate(() => { const s = window.__wizardAssetsScene; s.onContextLost({ preventDefault() {} }); s.onContextRestored(); });
  expect(await page.evaluate(() => window.__wizardAssetsScene.scene.children.filter(o => o.name === 'WizardLightingV4').length)).toBe(1);
  await page.evaluate(() => window.__wizardAssetsScene.dispose()); await context.close();
  expect(errors).toEqual([]);
  fs.writeFileSync(`${out}/results.json`, JSON.stringify({ results, all16Loaded: loaded, errors,
    note: 'Render timings belong to this browser/GPU only, not real-device FPS. Context callback recovery is not a physical GPU reset.' }, null, 2));
  console.log(JSON.stringify({ cases: results.length, all16Loaded: loaded.length, errors }));
} finally { await browser.close(); }
