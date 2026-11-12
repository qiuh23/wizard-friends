import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createTableWarmth } from '../src/rendering/wizard-warmth.mjs';

test('warm pools stay under cards, follow inward placement and hide with their anchors', () => {
  const scene = new THREE.Scene();
  const candles = [-4.65, 4.6].map(x => {
    const wrapper = new THREE.Group(); wrapper.position.x = x;
    wrapper.scale.setScalar(.55); scene.add(wrapper); return { wrapper };
  });
  const warmth = createTableWarmth({ THREE, scene, candles });
  const visible = o => Boolean(o.visible && o.parent);
  warmth.update({ small: false, visible });
  assert.equal(warmth.pools.length, 2);
  assert.ok(warmth.pools[0].position.x > candles[0].wrapper.position.x);
  assert.ok(warmth.pools[1].position.x < candles[1].wrapper.position.x);
  assert.ok(warmth.pools[0].material.opacity > warmth.pools[1].material.opacity);
  for (const pool of warmth.pools) {
    assert.ok(pool.position.y > .35 && pool.position.y < .382);
    assert.equal(pool.material.depthTest, true); assert.equal(pool.material.depthWrite, false);
  }
  const width = warmth.pools[0].scale.x;
  candles[0].wrapper.scale.setScalar(.275); candles[1].wrapper.removeFromParent();
  warmth.update({ small: true, visible });
  assert.equal(warmth.pools[0].scale.x, width / 2);
  assert.equal(warmth.pools[1].visible, false);
  const resources = [warmth.texture, warmth.pools[0].geometry, ...warmth.pools.map(p => p.material)];
  let disposed = 0; resources.forEach(r => r.addEventListener('dispose', () => disposed++));
  warmth.dispose(); warmth.dispose(); warmth.update({ small: false, visible });
  assert.equal(disposed, resources.length);
  assert.equal(warmth.pools.every(p => !p.parent), true);
});
