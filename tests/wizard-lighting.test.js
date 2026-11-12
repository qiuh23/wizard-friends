import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createWizardLighting } from '../src/rendering/wizard-lighting.mjs';

function setup(previousShadow = false, shadows = false) {
  const scene = new THREE.Scene(), ancestor = new THREE.Group();
  ancestor.position.set(4, 2, -3); ancestor.rotation.y = .37; ancestor.scale.setScalar(1.3); scene.add(ancestor);
  const candles = Array.from({ length: 4 }, (_, i) => {
    const wrapper = new THREE.Group(), visualRoot = new THREE.Group(), flame = new THREE.Mesh(new THREE.SphereGeometry(.05, 8, 6));
    wrapper.position.set(i - 2, 0, -2); wrapper.scale.setScalar(.55);
    flame.position.set(.015, 1.91, 0); flame.scale.set(1, 1.1, 1); flame.castShadow = true;
    ancestor.add(wrapper); wrapper.add(visualRoot); visualRoot.add(flame);
    return { wrapper, visualRoot, flame };
  });
  const renderer = { toneMappingExposure: 1.4, shadowMap: { enabled: previousShadow } }, legacy = new THREE.PointLight(); scene.add(legacy);
  return { scene, ancestor, candles, renderer, legacy,
    rig: createWizardLighting({ THREE, scene, renderer, candles, legacyLights: [legacy], shadows }) };
}

test('flame world positions and inverse-square scale compensation follow transformed ancestors', () => {
  const { rig, candles } = setup(); rig.group.position.set(1, .2, -.5); rig.group.rotation.y = .2;
  rig.update({ width: 1000, height: 700, reducedMotion: true });
  candles.forEach((c, i) => {
    assert.ok(Math.abs(c.visualRoot.getWorldPosition(new THREE.Vector3()).y - .36) < 1e-7);
    assert.ok(c.flame.getWorldPosition(new THREE.Vector3()).distanceTo(rig.points[i].getWorldPosition(new THREE.Vector3())) < 1e-7);
    assert.ok(Math.abs(rig.points[i].intensity - 12 * (.55 * 1.3) ** 2) < 1e-7);
    assert.equal(c.flame.castShadow, false);
  }); rig.dispose();
});

test('desktop seven-light budget; phone, hero phone, compact and low-power four-light budget', () => {
  const { rig } = setup();
  assert.equal(rig.update({ width: 1000, height: 700 }).pointLights, 4); assert.equal(rig.rim.visible, true);
  for (const options of [{ lowPower: true }, { width: 390, height: 844 }, { mode: 'hero', width: 390, height: 844 }, { compact: true }]) {
    assert.equal(rig.update(options).pointLights, 2); assert.equal(rig.rim.visible, false);
    let visible = 0; rig.group.traverseVisible(o => { if (o.isLight) visible++; }); assert.equal(visible, 4);
  } rig.dispose();
});

test('hidden ancestors, detached wrappers and detached visuals turn corresponding points off', () => {
  const { rig, ancestor, candles } = setup();
  ancestor.visible = false; assert.equal(rig.update().pointLights, 0); ancestor.visible = true;
  candles[0].flame.visible = false; assert.equal(rig.update().pointLights, 3); candles[0].flame.visible = true;
  candles[0].wrapper.removeFromParent(); assert.equal(rig.update().pointLights, 3); ancestor.add(candles[0].wrapper);
  candles[0].visualRoot.removeFromParent(); assert.equal(rig.update().pointLights, 3); rig.dispose();
});

test('pause retains flame pose and intensity; reduced motion returns baseline', () => {
  const { rig, candles } = setup(); rig.update({ time: 730 });
  const scales = candles.map(c => c.flame.scale.y), intensities = rig.points.map(p => p.intensity);
  rig.update({ paused: true, time: 20000 });
  candles.forEach((c, i) => assert.equal(c.flame.scale.y, scales[i])); rig.points.forEach((p, i) => assert.equal(p.intensity, intensities[i]));
  rig.update({ reducedMotion: true, time: 20000 }); candles.forEach(c => assert.equal(c.flame.scale.y, 1.1)); rig.dispose();
});

test('duplicate rig rejected; disposal restores originals and releases shadow targets once', () => {
  const { rig, scene, renderer, candles, legacy } = setup();
  assert.throws(() => createWizardLighting({ THREE, scene, renderer, candles }), /Dispose/);
  let count = 0; for (const point of rig.points) { point.shadow.map = { dispose() { count++; } }; point.shadow.mapPass = { dispose() { count++; } }; }
  rig.dispose(); rig.dispose(); assert.equal(count, 8); assert.equal(legacy.visible, true); assert.equal(renderer.toneMappingExposure, 1.4);
  candles.forEach(c => { assert.equal(c.flame.castShadow, true); assert.equal(c.flame.scale.y, 1.1); }); assert.equal(rig.group.parent, null);
  assert.equal(rig.update(), undefined);
});

test('default no shadows, existing global shadow state retained; optional one shadow disabled on low power', () => {
  const a = setup(true); a.rig.update({ lowPower: true }); assert.equal(a.renderer.shadowMap.enabled, true); a.rig.dispose();
  const b = setup(false, true); assert.equal(b.rig.update({ width: 1000, height: 700 }).shadowPointLights, 1);
  assert.equal(b.rig.update({ lowPower: true }).shadowPointLights, 0); assert.equal(b.renderer.shadowMap.enabled, false); b.rig.dispose();
});
