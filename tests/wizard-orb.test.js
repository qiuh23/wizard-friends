import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createCrystalOrb } from '../src/rendering/wizard-orb.mjs';

function setup() {
  const scene = new THREE.Scene(), wrapper = new THREE.Group();
  wrapper.position.set(4, 0, 2); wrapper.scale.setScalar(.68); scene.add(wrapper);
  const original = new THREE.MeshStandardMaterial(), geometry = new THREE.SphereGeometry(.43, 28, 20);
  const orb = new THREE.Mesh(geometry, original); orb.position.y = .96; wrapper.add(orb);
  return { scene, wrapper, original, geometry, orb, glow: createCrystalOrb({ THREE, orb, scene }) };
}

test('crystal has transparent depth-tested shell, internal core and bounded soft texture', () => {
  const { glow, orb } = setup();
  assert.equal(glow.shell.transmission, 0); assert.equal(glow.shell.depthWrite, false);
  assert.equal(glow.shell.depthTest, true); assert.ok(glow.shell.opacity < .5);
  assert.equal(glow.heart.parent, orb); assert.equal(glow.heart.material.transparent, false);
  assert.ok(glow.heart.geometry.parameters.radius < .43);
  assert.equal(glow.core.parent, orb); assert.equal(glow.halo.parent, orb);
  assert.equal(glow.core.material.depthTest, true); assert.equal(glow.core.material.toneMapped, false);
  assert.equal(glow.core.material.map, glow.halo.material.map);
  assert.equal(glow.pool.material.map, glow.texture);
  const { data, width, height } = glow.texture.image;
  assert.equal(width, 64); assert.equal(height, 64);
  assert.equal(data[3], 0); assert.ok(data[(32 * 64 + 32) * 4 + 3] > 250);
  glow.dispose();
});

test('pool follows resize without floating, pause freezes and reduced motion resets the pulse', () => {
  const { glow, wrapper } = setup();
  glow.update({ visible: true, time: 1000 });
  const value = glow.core.material.opacity, diameter = glow.pool.scale.x;
  glow.update({ visible: true, paused: true, time: 9000 });
  assert.equal(glow.core.material.opacity, value);
  wrapper.position.set(-2, .5, -3); wrapper.scale.setScalar(.34);
  glow.update({ visible: true, small: true, reducedMotion: true, time: 9000 });
  assert.equal(glow.core.material.opacity, .78);
  assert.equal(glow.pool.material.opacity, .12);
  assert.deepEqual(glow.pool.position.toArray(), [-2, .356, -3]);
  assert.ok(Math.abs(glow.pool.scale.x - diameter / 2) < 1e-8);
  glow.update({ visible: false }); assert.equal(glow.pool.visible, false);
  glow.dispose();
});

test('disposal releases only owned resources once and restores the cached GLB material', () => {
  const { glow, original, geometry, orb } = setup();
  const resources = [glow.heart.geometry, glow.heart.material, glow.shell, glow.core.material, glow.halo.material, glow.pool.material, glow.pool.geometry, glow.texture];
  const counts = resources.map(() => 0); let shared = 0;
  resources.forEach((r, i) => r.addEventListener('dispose', () => counts[i]++));
  for (const r of [original, geometry, glow.core.geometry]) r.addEventListener('dispose', () => shared++);
  glow.dispose(); glow.dispose(); glow.update({ visible: true });
  assert.equal(orb.material, original); assert.deepEqual(counts, resources.map(() => 1));
  assert.equal(shared, 0); assert.equal(orb.children.length, 0); assert.equal(glow.pool.parent, null);
});

test('visible blue highlight stays in front of opaque heart and inside glass as camera/parent move', () => {
  const scene=new THREE.Scene(),parent=new THREE.Group();scene.add(parent);
  const orb=new THREE.Mesh(new THREE.SphereGeometry(.43,20,14),new THREE.MeshStandardMaterial());parent.add(orb);
  const camera=new THREE.PerspectiveCamera();camera.position.set(0,8,5);
  const glow=createCrystalOrb({THREE,orb,scene,camera});
  const radius=orb.geometry.boundingSphere.radius;
  for(const angle of [0,.7,1.5]){
    parent.position.set(3,0,2);parent.rotation.y=angle;parent.scale.setScalar(.4+angle*.1);
    glow.update({visible:true,time:1200});
    const direction=orb.worldToLocal(camera.getWorldPosition(new THREE.Vector3())).normalize();
    assert.ok(glow.core.position.dot(direction)>radius*.82,'highlight is ahead of the opaque heart');
    assert.ok(Math.abs(glow.core.position.length()-radius*.86)<1e-6);
    assert.ok(Math.hypot(glow.core.position.length(),radius*.4)<radius,'luminous disk stays inside glass');
    assert.equal(glow.core.material.depthTest,true);
  }
  const emissive=glow.heart.material.emissiveIntensity;
  glow.update({visible:true,paused:true,time:9000});assert.equal(glow.heart.material.emissiveIntensity,emissive);
  glow.update({visible:true,reducedMotion:true,time:9000});assert.equal(glow.heart.material.emissiveIntensity,.7);
  glow.dispose();
});
