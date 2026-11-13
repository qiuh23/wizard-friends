import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { TABLE_ASSETS, WizardAssetLibrary, WizardTableAssets, disposeObjectResources } from '../src/rendering/wizard-assets.mjs';

const directory = new URL('../public/assets/wizard-v4/', import.meta.url);
const manifest = JSON.parse(await fs.readFile(new URL('manifest.json', directory)));
// Geometry, materials and node hierarchy are parsed by the real GLTFLoader.
// Texture decoding and WebGL are covered by the separate browser regression.
const loader = new GLTFLoader();
loader.register(parser => ({ name: 'CPU_TEXTURE_VALIDATION', loadTexture: async index => {
  const image = parser.json.images[parser.json.textures[index].source];
  assert.equal(image.uri, undefined); assert.equal(image.mimeType, 'image/png');
  const bytes = new Uint8Array(await parser.getDependency('bufferView', image.bufferView));
  assert.deepEqual([...bytes.slice(0, 8)], [137,80,78,71,13,10,26,10]);
  return new THREE.Texture();
} }));
const parsed = new Map();
for (const asset of manifest.assets) {
  const bytes = await fs.readFile(new URL(asset.file, directory));
  const json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
  assert.equal(json.buffers.every(buffer => !buffer.uri), true);
  assert.equal((json.images || []).every(image => !image.uri && image.bufferView !== undefined), true);
  const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  parsed.set(asset.name, { ...(await loader.parseAsync(data, '')), bytes });
}

function fakeTable() {
  const scene = new THREE.Scene(), geometry = new THREE.BoxGeometry(), material = new THREE.MeshStandardMaterial();
  const group = () => { const g = new THREE.Group(); g.add(new THREE.Mesh(geometry, material)); scene.add(g); return g; };
  const candles = Array.from({ length: 4 }, group);
  const legacyLights = Array.from({ length: 8 }, (_, i) => {
    const light = i < 3 ? new THREE.DirectionalLight() : new THREE.PointLight();
    (i < 4 ? scene : candles[i - 4]).add(light); return light;
  });
  const table = { scene, candles, legacyLights, tableSurface: [group(), group()], tableInlay: group(),
    book: group(), orbStand: group(), trumpRingMaterial: new THREE.MeshBasicMaterial(),
    renderer: { toneMappingExposure: 1.4, shadowMap: { enabled: false } },
    resize() { this.resizeCount = (this.resizeCount || 0) + 1; }, requestDraw() {} };
  return table;
}
const clonedLoader = () => ({ loadAsync: async url => {
  const name = url.split('/').at(-1).replace('.glb', '');
  return { scene: parsed.get(name).scene.clone(true) };
} });

test('all 16 packaged GLBs match delivered bytes and parse with real Three', async () => {
  const checksums = JSON.parse(await fs.readFile(new URL('checksums.json', directory)));
  assert.equal(manifest.assets.length, 16); assert.equal(TABLE_ASSETS.length, 11);
  for (const asset of manifest.assets) {
    const { bytes, scene } = parsed.get(asset.name);
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), checksums[asset.file]);
    assert.equal(bytes.length, asset.bytes);
    let triangles = 0;
    scene.traverse(object => {
      assert.ok(!object.isLight && !object.isCamera);
      if (object.isMesh) triangles += (object.geometry.index?.count || object.geometry.attributes.position.count) / 3;
    });
    assert.equal(triangles, asset.triangles);
  }
});

test('one pending load per URL; rejected requests can retry', async () => {
  let calls = 0;
  const library = new WizardAssetLibrary({ loadAsync: async () => { calls++; if (calls === 1) throw Error('404'); return { scene: new THREE.Group() }; } });
  const first = library.load('test'); assert.equal(first, library.load('test'));
  await assert.rejects(first, /404/); assert.equal(calls, 1);
  await library.load('test'); await library.load('test'); assert.equal(calls, 2);
  library.dispose(); await assert.rejects(library.load('test'), /disposed/);
});

test('atomic install retains wrappers, card-height clearance, eight exact old lights and trump material', async () => {
  const table = fakeTable(), oldBook = table.book, oldOrb = table.orbStand, oldCandles = [...table.candles];
  const assets = new WizardTableAssets(table, { loader: clonedLoader() });
  assert.equal(await assets.load(), true); assert.equal(assets.status, 'ready');
  assert.equal(table.book, oldBook); assert.equal(table.orbStand, oldOrb); assert.deepEqual(table.candles, oldCandles);
  assert.equal(table.tableSurface.length, 2); assert.equal(table.legacyLights.every(light => !light.visible), true);
  assert.equal(table.scene.children.filter(object => object.name === 'WizardLightingV4').length, 1);
  assert.equal(table.orb.name, 'Orb');
  const felt = new THREE.Box3().setFromObject(table.tableSurface[1]);
  assert.ok(felt.max.y < .382); assert.ok(Math.abs(felt.max.y - .35) < .001);
  table.tableInlay.traverse(mesh => { if (mesh.isMesh) assert.equal(mesh.material, table.trumpRingMaterial); });
  const state = assets.update({ mode: 'game', width: 1440, height: 900, reducedMotion: true });
  assert.equal(state.pointLights, 4); assert.equal(state.shadowPointLights, 0);
  assert.equal(assets.corners.visible, true);
  for (const [i, candle] of assets.candles.entries()) {
    assert.ok(Math.abs(candle.visualRoot.getWorldPosition(new THREE.Vector3()).y - .36) < 1e-8);
    assert.ok(candle.flame.getWorldPosition(new THREE.Vector3()).distanceTo(table.assetLighting.points[i].getWorldPosition(new THREE.Vector3())) < 1e-8);
  }
  assert.equal(await assets.load(), false); assert.equal(table.resizeCount, 1);
  assets.dispose(); assert.equal(table.scene.getObjectByName('WizardLightingV4'), undefined);
});

test('missing flame leaves all procedural geometry and lights untouched', async () => {
  const table = fakeTable(), surfaces = [...table.tableSurface], bookChildren = [...table.book.children];
  const source = clonedLoader(); let missing = true;
  const assets = new WizardTableAssets(table, { loader: { loadAsync: async url => {
    const gltf = await source.loadAsync(url);
    if (missing && url.endsWith('/wizard_candle.glb')) gltf.scene.getObjectByName('Flame').removeFromParent();
    return gltf;
  } } });
  assert.equal(await assets.load(), false); assert.equal(assets.status, 'fallback');
  assert.match(assets.error.message, /Missing flame/);
  assert.deepEqual(table.tableSurface, surfaces); assert.deepEqual(table.book.children, bookChildren);
  assert.equal(table.legacyLights.every(light => light.visible), true); assert.equal(table.assetLighting, undefined);
  missing = false;
  assert.equal(await assets.load(), true); assert.equal(assets.status, 'ready');
  assets.dispose();
});

test('404 preserves fallback and one explicit retry installs without duplicate lights', async () => {
  const table = fakeTable(), source = clonedLoader(); let fail = true, calls = 0;
  const assets = new WizardTableAssets(table, { loader: { loadAsync: async url => {
    calls++; if (fail && url.endsWith('/wizard_table_felt.glb')) throw Error('404 felt');
    return source.loadAsync(url);
  } } });
  assert.equal(await assets.load(), false); assert.equal(table.legacyLights.every(light => light.visible), true);
  assert.equal(calls, 11); fail = false;
  assert.equal(await assets.load(), true); assert.equal(calls, 12);
  assert.equal(table.scene.children.filter(object => object.name === 'WizardLightingV4').length, 1);
  assets.dispose();
});

test('late load after disposal never installs and releases shared resources once', async () => {
  const table = fakeTable(), root = new THREE.Group(), geometry = new THREE.BoxGeometry(), texture = new THREE.Texture();
  const material = new THREE.MeshStandardMaterial({ map: texture, normalMap: texture });
  root.add(new THREE.Mesh(geometry, material), new THREE.Mesh(geometry, material));
  const disposed = { geometry: 0, material: 0, texture: 0 };
  for (const [key, item] of Object.entries({ geometry, material, texture })) item.addEventListener('dispose', () => disposed[key]++);
  let resolve; const promise = new Promise(r => { resolve = r; });
  const assets = new WizardTableAssets(table, { loader: { loadAsync: () => promise } });
  const pending = assets.load(); assets.dispose(); assets.dispose(); resolve({ scene: root });
  assert.equal(await pending, false); assert.equal(assets.status, 'disposed'); assert.equal(table.resizeCount, undefined);
  assert.deepEqual(disposed, { geometry: 1, material: 1, texture: 1 });
});

test('shared texture bitmaps, geometry and materials are released only once', () => {
  const root = new THREE.Group(), geometry = new THREE.BoxGeometry(); let closed = 0;
  const bitmap = { close() { closed++; } }, map = new THREE.Texture(bitmap), normalMap = new THREE.Texture(bitmap);
  const material = new THREE.MeshStandardMaterial({ map, normalMap });
  root.add(new THREE.Mesh(geometry, material), new THREE.Mesh(geometry, material));
  const released = disposeObjectResources([root, root]);
  disposeObjectResources([root], [map, normalMap], released); assert.equal(closed, 1);
});

test('installed crystal, lantern and warm candles share the existing light budget', async () => {
  const table = fakeTable(), assets = new WizardTableAssets(table, { loader: clonedLoader() });
  assert.equal(await assets.load(), true);
  const rig = table.assetLighting;
  const originalExposure = 1.25;
  let state = assets.update({ width: 1440, height: 900 });
  assert.equal(state.pointLights, 4); assert.equal(state.exposure, originalExposure);
  assert.deepEqual(rig.points.map(p => p.visible), [true, true, false, false]);
  assert.equal(rig.orbPoint.visible, true); assert.equal(rig.lanternPoint.visible, true);
  assert.equal(table.orb.material.name, 'CrystalShell');
  assert.equal(table.orb.material.transparent, true); assert.equal(table.orb.material.depthWrite, false);
  assert.equal(table.orb.material.transmission, 0);
  assert.ok(table.orb.getWorldPosition(new THREE.Vector3()).distanceTo(rig.orbPoint.getWorldPosition(new THREE.Vector3())) < 1e-8);
  assert.equal(rig.crystal.pool.position.y, .356);
  assert.ok(rig.crystal.pool.position.y < .382);
  const lantern = table.scene.getObjectByName('WizardLantern');
  assert.equal(lantern.visible, true);
  assert.equal(lantern.parent, table.candles[2]);
  assert.equal(rig.warmth.lanternCore.parent, lantern);
  assert.ok(rig.warmth.lanternCore.material.opacity > .5);
  assert.ok(Math.abs(lantern.getWorldPosition(new THREE.Vector3()).y - .36) < 1e-8);
  for (const options of [{ width: 390, height: 844 }, { compact: true }]) {
    state = assets.update(options);
    assert.equal(state.pointLights, 4);
    assert.equal(rig.orbPoint.visible, true); assert.equal(rig.lanternPoint.visible, true);
    assert.equal(lantern.visible, true); assert.equal(assets.corners.visible, true);
    state = assets.update({ ...options, lowPower: true });
    assert.equal(state.pointLights, 2);
    assert.equal(rig.orbPoint.visible, false); assert.equal(rig.lanternPoint.visible, false);
    assert.equal(lantern.visible, false); assert.equal(rig.crystal.pool.visible, true);
  }
  assets.update({ width: 1440, height: 900 });
  assert.equal(lantern.visible, true); assert.equal(rig.orbPoint.visible, true);
  table.orbStand.visible = false;
  assert.equal(assets.update({}).pointLights, 4);
  assert.equal(rig.crystal.pool.visible, false); assert.equal(rig.orbPoint.visible, false);
  table.candles[2].visible = false;
  assert.equal(assets.update({}).pointLights, 3); assert.equal(rig.lanternPoint.visible, false);
  table.orbStand.visible = true; table.orbStand.removeFromParent();
  assets.update({}); assert.equal(rig.crystal.pool.visible, false);
  assets.dispose(); assert.equal(table.scene.getObjectByName('OrbTableGlow'), undefined);
});

test('actual GLB flames remain in mobile portrait/landscape viewport with player-selected light budgets', async t => {
  const original=globalThis.matchMedia,originalStyle=globalThis.getComputedStyle;globalThis.matchMedia=()=>({matches:false});
  let padding={};globalThis.getComputedStyle=()=>padding;
  t.after(()=>{if(original)globalThis.matchMedia=original;else delete globalThis.matchMedia;if(originalStyle)globalThis.getComputedStyle=originalStyle;else delete globalThis.getComputedStyle;});
  const {TableScene}=await import('../src/table-scene.js');
  const table=fakeTable();table.mode='game';
  table.coins=new THREE.Group();table.deck=new THREE.Group();
  table.tableProps=[table.book,table.orbStand,table.coins,table.deck,...table.candles]
    .map(group=>({group,position:group.position.clone(),scale:group.scale.clone()}));
  const assets=new WizardTableAssets(table,{loader:clonedLoader()});table.assets=assets;await assets.load();
  for(const [width,height] of [[320,568],[390,844],[430,932],[667,275],[740,320],[844,390],[932,430]]) {
    const compact=width>height, fov=compact?32:43;
    padding=compact?{paddingLeft:'47px',paddingRight:'21px'}:{paddingTop:'44px',paddingBottom:'34px'};
    const distance=THREE.MathUtils.clamp((width<=600?9.6:11.8)/(2*Math.tan(THREE.MathUtils.degToRad(fov/2))*width/height),height<=540&&width>=600?7.7:9,34);
    table.host={closest:()=>({dataset:{layoutMode:compact?'strip':'ring'}})};
    table.camera=new THREE.PerspectiveCamera(fov,width/height,.1,80);
    const angle=THREE.MathUtils.degToRad(58);table.camera.position.set(0,distance*Math.sin(angle),distance*Math.cos(angle));
    table.camera.lookAt(0,0,0);table.camera.updateProjectionMatrix();table.camera.updateMatrixWorld();
    for(const lowPower of [false,true,false]) {
      table.low=lowPower;
      TableScene.prototype.layoutDecorations.call(table,width,height);
      const summary=assets.update({width,height,compact,lowPower,reducedMotion:true});
      assert.equal(summary.pointLights,lowPower?2:4);assert.equal(summary.shadowPointLights,0);
      assert.equal(table.assetLighting.orbPoint.visible,!lowPower);
      assert.equal(table.assetLighting.lanternPoint.visible,!lowPower);
      for(const [i,c] of assets.candles.entries()) {
        const position=c.flame.getWorldPosition(new THREE.Vector3());
        const screen=position.clone().project(table.camera);
        assert.ok(screen.x>-1&&screen.x<1&&screen.y>-1&&screen.y<1,`${width}x${height} flame ${i}: ${screen.toArray()}`);
        assert.ok(Math.abs(c.visualRoot.getWorldPosition(new THREE.Vector3()).y-.36)<1e-7);
        const point=table.assetLighting.points[i];
        assert.ok(position.distanceTo(point.getWorldPosition(new THREE.Vector3()))<1e-7);
        assert.equal(point.visible,i<2);assert.equal(point.intensity>0,i<2);
        const bounds=new THREE.Box3().setFromObject(c.visualRoot);
        for(const x of [bounds.min.x,bounds.max.x])for(const y of [bounds.min.y,bounds.max.y])for(const z of [bounds.min.z,bounds.max.z]) {
          const p=new THREE.Vector3(x,y,z).project(table.camera),px=(p.x+1)*width/2,py=(1-p.y)*height/2;
          assert.ok(px>=(compact?47:0)+7 && px<=width-(compact?21:0)-7,`${width}x${height} horizontal bounds ${px}`);
          assert.ok(py>=(compact?0:44)+55 && py<=height-(compact?100:46)+1,`${width}x${height} reserved HUD/hand bounds ${py}`);
        }
      }
    }
  }
  assets.dispose();
});
