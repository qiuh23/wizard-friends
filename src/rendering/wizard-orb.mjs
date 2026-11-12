/** A clear shell around a soft blue core, without bloom or a transmission pass. */
export function createCrystalOrb({ THREE, orb, scene, camera = null }) {
  const original = orb.material;
  const originalOrder = orb.renderOrder;
  const shell = new THREE.MeshPhysicalMaterial({ color: '#a6d8f1', emissive: '#174a70', emissiveIntensity: .22, roughness: .2,
    metalness: 0, clearcoat: 1, clearcoatRoughness: .1, transparent: true,
    opacity: .42, depthWrite: false, side: THREE.FrontSide });
  shell.name = 'CrystalShell';
  orb.material = shell;
  // Composite the glass highlights after its inner glow, still depth-tested
  // against the opaque tabletop/stand. No always-on-top UI glow.
  orb.renderOrder = 1;
  // A tiny radial texture is shared by the core, halo and tabletop reflection.
  // DataTexture also allows the exact resource to be tested without a DOM.
  const size = 64, data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const r = Math.hypot((x + .5) / size * 2 - 1, (y + .5) / size * 2 - 1);
    const i = (y * size + x) * 4;
    data[i] = data[i + 1] = data[i + 2] = 255;
    data[i + 3] = Math.round(255 * Math.max(0, 1 - r * r) ** 3);
  }
  const texture = new THREE.DataTexture(data, size, size);
  texture.magFilter = texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  orb.geometry.computeBoundingSphere();
  const radius = orb.geometry.boundingSphere.radius;
  const center = orb.geometry.boundingSphere.center;
  const sprite = (name, color, opacity, diameter) => {
    const material = new THREE.SpriteMaterial({ map: texture, color, opacity,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    const object = new THREE.Sprite(material); object.name = name;
    object.position.copy(center); object.scale.setScalar(radius * diameter);
    orb.add(object); return object;
  };
  // An opaque inner sphere keeps a complete silhouette even against the brass cradle.
  // Sprite-only cores let the stand show through and read as a hollow half-shell.
  const heart = new THREE.Mesh(new THREE.SphereGeometry(radius * .82, 20, 14),
    new THREE.MeshStandardMaterial({ color: '#367baa', emissive: '#246aa5',
      emissiveIntensity: .7, roughness: .32, metalness: .05 }));
  heart.name = 'OrbCrystalHeart'; heart.position.copy(center); orb.add(heart);
  const core = sprite('OrbBlueCore', '#b0e4ff', .78, .8);
  const halo = sprite('OrbBlueHalo', '#318ee8', .16, 2.5);
  const pool = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
    map: texture, color: '#2684b8', transparent: true, opacity: .12,
    blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
  }));
  pool.name = 'OrbTableGlow'; pool.rotation.x = -Math.PI / 2; scene.add(pool);
  const position = new THREE.Vector3(), scale = new THREE.Vector3(), view = new THREE.Vector3();
  let pulse = 1, disposed = false;
  function update({ visible, small, reducedMotion, paused, time = 0 }) {
    if (disposed) return;
    if (reducedMotion) pulse = 1;
    else if (!paused) pulse = 1 + Math.sin(time * .0008) * .035;
    // Keep the small highlight in front of the opaque heart but inside the shell.
    // A center-plane sprite would be entirely hidden by the new inner sphere.
    if (camera) { camera.getWorldPosition(view); orb.worldToLocal(view); view.sub(center).normalize(); }
    else view.set(0, 0, 1);
    core.position.copy(center).addScaledVector(view, radius * .86);
    heart.material.emissiveIntensity = .7 * pulse;
    core.material.opacity = .78 * pulse;
    halo.material.opacity = .16 * pulse;
    // Keep the small light pool below every played card, never over the UI.
    orb.getWorldPosition(position); orb.getWorldScale(scale);
    pool.position.set(position.x, .356, position.z);
    pool.scale.setScalar(radius * 4.6 * Math.max(Math.abs(scale.x), Math.abs(scale.z)));
    pool.material.opacity = (small ? .12 : .07) * pulse;
    pool.visible = visible;
  }
  function dispose() {
    if (disposed) return; disposed = true;
    orb.material = original; orb.renderOrder = originalOrder;
    for (const object of [core, halo, pool, heart]) {
      object.removeFromParent(); object.material.dispose();
    }
    pool.geometry.dispose(); heart.geometry.dispose(); shell.dispose(); texture.dispose();
  }
  return { update, dispose, shell, core, halo, pool, heart, texture };
}
