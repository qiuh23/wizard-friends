/** Soft candle bounce on the felt. Two quads, one 64px texture, no lights/pass/RAF.
 * The left pool is stronger to balance the blue crystal on the opposite side.
 */
export function createTableWarmth({ THREE, scene, candles, lantern = null }) {
  const size = 64, data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const r = Math.hypot((x + .5) / size * 2 - 1, (y + .5) / size * 2 - 1);
    const i = (y * size + x) * 4;
    data[i] = data[i + 1] = data[i + 2] = 255;
    data[i + 3] = Math.round(255 * Math.max(0, 1 - r * r) ** 3);
  }
  const texture = new THREE.DataTexture(data, size, size);
  texture.magFilter = texture.minFilter = THREE.LinearFilter; texture.needsUpdate = true;
  const lanternCore = lantern ? new THREE.Sprite(new THREE.SpriteMaterial({
    map: texture, color: '#ffe0a0', opacity: .9, blending: THREE.AdditiveBlending,
    depthWrite: false, toneMapped: false,
  })) : null;
  if (lanternCore) {
    lanternCore.name = 'LeftRuneLanternCore'; lanternCore.position.set(0, .39, 0);
    lanternCore.scale.set(.38, .5, 1); lantern.root.add(lanternCore);
  }
  const geometry = new THREE.PlaneGeometry(1, 1);
  const pools = [0, 1].map(i => {
    const pool = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
      map: texture, color: '#edac60', transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    }));
    pool.name = i === 0 ? 'LeftAmberTableGlow' : 'RightCandleTableGlow';
    pool.rotation.x = -Math.PI / 2; scene.add(pool); return pool;
  });
  const position = new THREE.Vector3(), scale = new THREE.Vector3();
  let disposed = false;
  function update({ small, visible }) {
    if (disposed) return;
    pools.forEach((pool, i) => {
      const anchor = candles[i].wrapper;
      pool.visible = visible(anchor);
      anchor.getWorldPosition(position); anchor.getWorldScale(scale);
      const s = Math.max(.08, Math.abs(scale.x));
      // Pull reflected light inward, not toward the screen edge; stay below cards.
      const inward = Math.sign(-position.x);
      pool.position.set(position.x + inward * .7 * s, .3555, position.z);
      pool.scale.set(4.6 * s, 3.5 * s, 1);
      pool.material.opacity = (i === 0 ? .18 : .09) * (small ? .85 : 1);
    });
  }
  function dispose() {
    if (disposed) return; disposed = true;
    pools.forEach(pool => { pool.removeFromParent(); pool.material.dispose(); });
    lanternCore?.removeFromParent(); lanternCore?.material.dispose();
    geometry.dispose(); texture.dispose();
  }
  return { pools, lanternCore, texture, update, dispose };
}
