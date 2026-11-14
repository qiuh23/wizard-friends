import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { createWizardLighting } from '../src/rendering/wizard-lighting.mjs';

// Reintroduce only the two removed operations as an executable historical oracle.
// Keep the rest of the implementation identical so this measures redundant work,
// not timing noise or a separately maintained lighting implementation.
async function historicalFactory() {
  const url = new URL('../src/rendering/wizard-lighting.mjs', import.meta.url);
  let source = await readFile(url, 'utf8');
  for (const statement of ['c.flame.getWorldPosition(p);', 'node.getWorldScale(scale);']) {
    assert.equal(source.split(statement).length, 2, `one ${statement} hot path`);
  }
  source = source.replace('c.flame.getWorldPosition(p);',
    'c.flame.updateWorldMatrix(true,false);c.flame.getWorldPosition(p);')
    .replace('node.getWorldScale(scale);',
      'node.updateWorldMatrix(true,false);node.getWorldScale(scale);')
    .replaceAll("'./wizard-orb.mjs'", JSON.stringify(new URL('./wizard-orb.mjs', url).href))
    .replaceAll("'./wizard-warmth.mjs'", JSON.stringify(new URL('./wizard-warmth.mjs', url).href));
  return (await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)).createWizardLighting;
}

function fixture(create) {
  const scene = new THREE.Scene(), ancestor = new THREE.Group();
  scene.add(ancestor); ancestor.position.set(4, 2, -3);
  ancestor.rotation.y = .37; ancestor.scale.setScalar(1.3);
  const candles = Array.from({ length: 4 }, (_, i) => {
    const wrapper = new THREE.Group(), visualRoot = new THREE.Group();
    const flame = new THREE.Mesh(new THREE.SphereGeometry(.05, 8, 6), new THREE.MeshBasicMaterial());
    ancestor.add(wrapper); wrapper.add(visualRoot); visualRoot.add(flame);
    wrapper.position.set(i - 2, 0, -2); wrapper.scale.setScalar(.55);
    flame.position.set(.015, 1.91, 0); flame.scale.set(1, 1.1, 1);
    return { wrapper, visualRoot, flame };
  });
  const orb = new THREE.Mesh(new THREE.SphereGeometry(.4, 12, 8), new THREE.MeshStandardMaterial());
  orb.position.set(2, 1, 0); ancestor.add(orb);
  const root = new THREE.Group(); candles[2].wrapper.add(root);
  const camera = new THREE.PerspectiveCamera(); camera.position.set(2, 8, 10); scene.add(camera);
  const renderer = { toneMappingExposure: 1.4, shadowMap: { enabled: false } };
  const rig = create({ THREE, scene, camera, renderer, candles, orb, lantern: { root, glass: [] } });
  rig.group.position.set(.2, .1, -.3); rig.group.rotation.y = .2;
  const objects = []; scene.traverse(object => objects.push(object));
  return { scene, ancestor, candles, orb, root, camera, renderer, rig, objects };
}

function state(f) {
  // Match the renderer's world-matrix refresh; retain detached objects in comparison.
  f.scene.updateMatrixWorld();
  return f.objects.map(o => ({
    position: o.position.toArray(), quaternion: o.quaternion.toArray(), scale: o.scale.toArray(),
    world: o.matrixWorld.toArray(), visible: o.visible, intensity: o.intensity,
    distance: o.distance, castShadow: o.castShadow, opacity: o.material?.opacity,
    emissiveIntensity: o.material?.emissiveIntensity,
  }));
}

function dispose(f) {
  f.rig.dispose();
  const resources = new Set();
  for (const o of f.objects) { if (o.geometry) resources.add(o.geometry); if (o.material) resources.add(o.material); }
  for (const resource of resources) resource.dispose();
}

test('lighting getters preserve rendered state with fewer ancestor traversals', async () => {
  const baseline = fixture(await historicalFactory()), optimized = fixture(createWizardLighting);
  const original = THREE.Object3D.prototype.updateWorldMatrix;
  let calls = 0;
  THREE.Object3D.prototype.updateWorldMatrix = function (...args) {
    calls++; return original.apply(this, args);
  };
  const scenarios = [
    ['desktop', { time: 730 }, null, 6],
    ['portrait', { width: 390, height: 844, time: 990 }, null, 6],
    ['compact', { compact: true, time: 1100 }, null, 6],
    ['moved ancestors', { time: 1200 }, f => {
      f.ancestor.position.set(-2, .7, 3); f.ancestor.rotation.set(.1, -.6, .05);
      f.ancestor.scale.setScalar(.8); f.camera.position.set(-4, 6, 8);
      f.candles[0].wrapper.scale.set(.6, .7, .8); f.orb.rotation.y = .8;
    }, 6],
    ['low power', { lowPower: true, time: 1400 }, null, 2],
    ['paused', { paused: true, time: 20000 }, null, 6],
    ['reduced motion', { reducedMotion: true, time: 30000 }, null, 6],
    ['hidden flame and orb', { time: 1500 }, f => { f.candles[0].flame.visible = false; f.orb.visible = false; }, 4],
    ['hidden ancestor', { time: 1600 }, f => { f.ancestor.visible = false; }, 0],
    ['restored visibility', { time: 1700 }, f => {
      f.ancestor.visible = true; f.candles[0].flame.visible = true; f.orb.visible = true;
    }, 6],
    ['detached wrapper', { time: 1800 }, f => f.candles[1].wrapper.removeFromParent(), 5],
    ['detached visual', { time: 1900 }, f => f.candles[3].visualRoot.removeFromParent(), 4],
    ['reattached props', { time: 2000 }, f => {
      f.ancestor.add(f.candles[1].wrapper); f.candles[3].wrapper.add(f.candles[3].visualRoot);
    }, 6],
  ];
  try {
    for (const [name, options, mutate, pointLights] of scenarios) {
      mutate?.(baseline); mutate?.(optimized);
      calls = 0; const expected = baseline.rig.update(options); const before = calls;
      calls = 0; const actual = optimized.rig.update(options); const after = calls;
      assert.ok(after < before, `${name}: ${after} traversals < ${before}`);
      assert.deepEqual(actual, expected, `${name}: diagnostic state`);
      assert.equal(actual.pointLights, pointLights, `${name}: point-light budget`);
      assert.equal(actual.shadowPointLights, 0, `${name}: shadows unchanged`);
      assert.deepEqual(state(optimized), state(baseline), `${name}: rendered object state`);
      assert.deepEqual(optimized.renderer, baseline.renderer, `${name}: renderer state`);
    }
  } finally {
    THREE.Object3D.prototype.updateWorldMatrix = original;
    dispose(baseline); dispose(optimized);
  }
});
