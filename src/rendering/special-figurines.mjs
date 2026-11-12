import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Hand-built tabletop miniatures: one vertex-colored mesh per character.
// No model fetch, skinning, texture, dynamic light or independent animation loop.
// Local sculpted shading keeps the toy readable without lifting the candlelit room.
export const SPECIAL_FIGURINE_SCALE = .8;
const key = new THREE.Vector3(-.35, .85, 1).normalize();
export function figurineShade(x, y, z) {
  return .64 + .36 * Math.max(0, x * key.x + y * key.y + z * key.z);
}
function sculpt(kind) {
  const parts = [];
  const add = (geometry, color, position, scale = [1, 1, 1], rotation = [0, 0, 0]) => {
    const source = geometry.index ? geometry.toNonIndexed() : geometry;
    if (source !== geometry) geometry.dispose();
    source.deleteAttribute('uv');
    source.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(...position),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)), new THREE.Vector3(...scale)));
    const c = new THREE.Color(color), colors = new Float32Array(source.attributes.position.count * 3);
    const normals = source.attributes.normal;
    for (let i = 0; i < colors.length; i += 3) {
      const vertex = i / 3, shade = figurineShade(normals.getX(vertex), normals.getY(vertex), normals.getZ(vertex));
      colors[i] = c.r * shade; colors[i + 1] = c.g * shade; colors[i + 2] = c.b * shade;
    }
    source.setAttribute('color', new THREE.BufferAttribute(colors, 3)); parts.push(source);
  };
  const sphere = (r, color, position, scale) => add(new THREE.SphereGeometry(r, 8, 5), color, position, scale);
  const cone = (r, h, color, position, rotation) => add(new THREE.ConeGeometry(r, h, 8), color, position, undefined, rotation);
  const cylinder = (a, b, h, color, position, rotation) => add(new THREE.CylinderGeometry(a, b, h, 8), color, position, undefined, rotation);
  const skin = '#f4d4ae', gold = '#efd193', dark = '#24243d';
  sphere(.09, dark, [-.10, .07, .045], [1, .7, 1.45]);
  sphere(.09, dark, [.10, .07, .045], [1, .7, 1.45]);
  if (kind === 'wizard') {
    cylinder(.13, .25, .49, '#7c91dc', [0, .31, 0]);
    cylinder(.15, .16, .055, gold, [0, .40, 0]);
    cone(.16, .30, '#596eb4', [-.19, .40, 0], [0, 0, -.60]);
    cone(.16, .30, '#596eb4', [.19, .40, 0], [0, 0, .60]);
    sphere(.145, skin, [0, .65, .055]);
    cone(.12, .26, '#fff3da', [0, .51, .16], [0, 0, Math.PI]);
    cylinder(.22, .22, .035, '#596eb4', [0, .775, 0]);
    cone(.19, .39, '#7c91dc', [-.015, .965, 0], [0, 0, .13]);
    cylinder(.19, .20, .035, gold, [0, .79, 0]);
    cylinder(.022, .027, .81, '#92693f', [.29, .47, .05]);
    add(new THREE.OctahedronGeometry(.085), '#b9f1ff', [.29, .91, .05]);
    sphere(.045, skin, [.275, .42, .055]);
  } else {
    cylinder(.14, .17, .30, '#c17eaf', [0, .34, 0]);
    for (const sign of [-1, 1]) {
      cylinder(.065, .07, .25, sign < 0 ? '#66c3b3' : '#f1c97a', [sign * .10, .19, 0]);
      cylinder(.06, .075, .26, sign < 0 ? '#f1c97a' : '#66c3b3', [sign * .20, .43, 0], [0, 0, sign * 1.0]);
      sphere(.055, skin, [sign * .30, .49, .01]);
    }
    cylinder(.18, .09, .07, '#efe2bf', [0, .52, 0]);
    sphere(.145, skin, [0, .67, .015]);
    cylinder(.155, .16, .05, '#c17eaf', [0, .78, 0]);
    for (const sign of [-1, 1]) {
      cone(.12, .30, sign < 0 ? '#66c3b3' : '#c17eaf', [sign * .12, .87, 0], [0, 0, -sign * .62]);
      sphere(.045, gold, [sign * .21, .99, 0]);
    }
    cone(.09, .26, gold, [0, .88, -.055], [-.40, 0, 0]);
    sphere(.04, gold, [0, 1.01, -.11]);
    sphere(.038, '#c77878', [0, .66, .155]);
    for (const y of [.29, .39]) sphere(.025, gold, [0, y, .16]);
  }
  for (const x of [-.05, .05]) sphere(.022, dark, [x, .695, kind === 'wizard' ? .185 : .143], [1, 1.3, .65]);
  const geometry = mergeGeometries(parts); parts.forEach(part => part.dispose());
  geometry.computeBoundingBox(); geometry.computeBoundingSphere(); return geometry;
}

export class SpecialFigurines {
  constructor() { this.geometries = new Map(); this.disposed = false; }
  create(kind) {
    if (this.disposed || !['wizard', 'jester'].includes(kind)) return null;
    if (!this.geometries.has(kind)) this.geometries.set(kind, sculpt(kind));
    // Built-in unlit material + normal-based vertex shading avoids black faces in
    // the dim center of the table, including low-power phones. No custom shader,
    // bloom, global exposure change or point light is needed. Depth testing stays on.
    const material = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, fog: false });
    const mesh = new THREE.Mesh(this.geometries.get(kind), material);
    mesh.name = `SpecialFigurine_${kind}`; mesh.castShadow = mesh.receiveShadow = false;
    mesh.userData.specialKind = kind; return mesh;
  }
  release(mesh) { mesh?.removeFromParent(); mesh?.material.dispose(); }
  dispose() {
    if (this.disposed) return; this.disposed = true;
    for (const geometry of this.geometries.values()) geometry.dispose();
    this.geometries.clear();
  }
}
