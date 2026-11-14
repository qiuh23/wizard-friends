import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createWizardLighting } from './wizard-lighting.mjs';
import { wizardAssetURL } from './wizard-asset-url.mjs';

const CANDLES = [
  ['wizard_candle', 'Flame'],
  ['wizard_candle_085', 'wizard_candle_085_Flame'],
  ['wizard_candle_070', 'wizard_candle_070_Flame'],
  ['wizard_candle_135', 'wizard_candle_135_Flame'],
];
// The remaining five library props are available, not extra downloads or clutter.
export const TABLE_ASSETS = Object.freeze([
  'wizard_table_carved_frame', 'wizard_table_felt', 'wizard_table_rune_inlay',
  'wizard_open_tome', 'wizard_orb_stand', 'wizard_table_corner_plate',
  'wizard_rune_lantern',
  ...CANDLES.map(([name]) => name),
]);

/** Dispose shared resources once, including GLTF textures beyond material.map. */
export function disposeObjectResources(roots, extraTextures = [], disposed = new WeakSet()) {
  const resources = new Set(extraTextures);
  for (const root of roots) root?.traverse(object => {
    if (object.geometry) resources.add(object.geometry);
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials.filter(Boolean)) {
      resources.add(material);
      for (const value of Object.values(material)) if (value?.isTexture) resources.add(value);
    }
  });
  for (const resource of resources) {
    if (!resource || disposed.has(resource)) continue;
    disposed.add(resource);
    resource.dispose();
    // GLTFLoader uses ImageBitmap when available; texture.dispose alone does
    // not release its CPU pixels. Several textures may share one bitmap.
    const image = resource.isTexture && resource.source?.data;
    if (image?.close && !disposed.has(image)) { disposed.add(image); image.close(); }
  }
  return disposed;
}

/** Cache per table owner, never let a destroyed table poison another instance. */
export class WizardAssetLibrary {
  constructor(loader = new GLTFLoader(), baseUrl) {
    this.loader = loader; this.baseUrl = baseUrl;
    this.promises = new Map(); this.roots = new Set(); this.released = new WeakSet();
    this.disposed = false;
  }
  load(name) {
    if (this.disposed) return Promise.reject(new Error('Wizard asset library disposed'));
    const url = wizardAssetURL(name, this.baseUrl);
    if (!this.promises.has(url)) {
      const promise = this.loader.loadAsync(url).then(gltf => {
        if (this.disposed) {
          disposeObjectResources(gltf.scenes || [gltf.scene], [], this.released);
          throw new Error('Wizard asset library disposed during load');
        }
        if (!gltf.scene) throw new Error(`Missing GLTF scene: ${name}`);
        for (const scene of gltf.scenes || [gltf.scene]) this.roots.add(scene);
        return gltf.scene;
      }).catch(error => {
        this.promises.delete(url); // A later explicit retry may recover a 404.
        throw error;
      });
      this.promises.set(url, promise);
    }
    return this.promises.get(url);
  }
  dispose(roots = [], textures = []) {
    this.disposed = true;
    disposeObjectResources([...roots, ...this.roots], textures, this.released);
    this.roots.clear(); this.promises.clear();
  }
  invalidate() {
    // Only called after all loads finished but validation/installation failed.
    // No cached resource is then attached to the table. A corrected GLB must
    // be fetched again, rather than retrying a permanently cached bad scene.
    disposeObjectResources(this.roots, [], this.released);
    this.roots.clear(); this.promises.clear();
  }
}

export class WizardTableAssets {
  constructor(table, options = {}) {
    this.table = table;
    this.library = new WizardAssetLibrary(options.loader, options.baseUrl);
    this.retired = [];
    this.status = 'idle'; this.error = null; this.disposed = false;
  }
  load() {
    if (this.disposed || this.status === 'ready') return Promise.resolve(false);
    if (this.pending) return this.pending;
    this.status = 'loading'; this.error = null;
    this.pending = Promise.all(TABLE_ASSETS.map(async name => [name, await this.library.load(name)]))
      .then(entries => {
        if (this.disposed) return false;
        try { this.install(new Map(entries)); }
        catch (error) { this.library.invalidate(); throw error; }
        this.status = 'ready';
        // Invalidate layout even when dimensions have not changed: the newly
        // installed wrappers must receive the current responsive scale.
        this.table.layoutKey = null;
        this.table.resize();
        this.table.requestDraw();
        return true;
      }).catch(error => {
        if (!this.disposed) {
          this.status = 'fallback'; this.error = error;
          console.warn('Wizard table assets unavailable; keeping the procedural table and lights.', error);
        }
        return false;
      }).finally(() => { this.pending = null; });
    return this.pending;
  }
  install(sources) {
    const table = this.table;
    const clone = name => {
      const root = sources.get(name).clone(true);
      root.traverse(object => {
        if (object.isLight || object.isCamera) throw new Error(`Unexpected camera/light in ${name}`);
        if (object.isMesh) { object.castShadow = false; object.receiveShadow = true; }
      });
      return root;
    };
    const frame = new THREE.Group(), felt = new THREE.Group();
    frame.name = 'WizardTableFrame'; felt.name = 'WizardTableFelt';
    frame.position.y = -.395; felt.position.y = .3225;
    frame.add(clone('wizard_table_carved_frame')); felt.add(clone('wizard_table_felt'));
    const corners = new THREE.Group(); corners.name = 'WizardCornerPlates';
    for (const x of [-5.7, 5.7]) for (const z of [-3.53, 3.53]) {
      const plate = clone('wizard_table_corner_plate');
      plate.position.set(x, .321 - frame.position.y, z); corners.add(plate);
    }
    frame.add(corners);
    const inlay = clone('wizard_table_rune_inlay'); inlay.position.y = .352;
    inlay.traverse(object => { if (object.isMesh) object.material = table.trumpRingMaterial; });
    const book = clone('wizard_open_tome'); book.position.y = -.1625;
    const orbStand = clone('wizard_orb_stand'); orbStand.position.y = .405;
    const orb = orbStand.getObjectByName('Orb');
    if (!orb?.isMesh) throw new Error('Missing Orb mesh in wizard_orb_stand');
    const candles = CANDLES.map(([name, flameName], i) => {
      const visualRoot = clone(name), flame = visualRoot.getObjectByName(flameName);
      if (!flame?.isMesh) throw new Error(`Missing flame mesh: ${flameName}`);
      // A small companion votive makes each lower cluster visibly richer without
      // another download or light. It shares the nearby candle's warm pool.
      if (i >= 2) {
        const votive = clone('wizard_candle_070');
        votive.name = `WizardCompanionCandle_${i}`;
        votive.scale.setScalar(.6);
        votive.position.set(i === 2 ? .62 : -.62, 0, .26);
        visualRoot.add(votive);
      }
      return { wrapper: table.candles[i], visualRoot, flame };
    });
    const lantern = clone('wizard_rune_lantern');
    lantern.name = 'WizardLantern';
    const lanternGlass = [];
    lantern.traverse(object => {
      if (object.isMesh && object.material.name.startsWith('Orb_jade')) lanternGlass.push(object);
    });
    if (!lanternGlass.length) throw new Error('Missing lantern glass material');
    // Validate everything before detaching a single fallback object. Wrapper
    // identity is retained for layoutDecorations, tableProps and deck picking.
    const swaps = [[table.tableInlay, inlay], [table.book, book], [table.orbStand, orbStand],
      ...candles.map(({ wrapper, visualRoot }) => [wrapper, visualRoot])];
    const priorChildren = swaps.map(([wrapper]) => [...wrapper.children]);
    let lighting;
    try {
      swaps.forEach(([wrapper, root]) => { wrapper.clear(); wrapper.add(root); });
      // Reuse the left secondary candle wrapper, balancing the right-hand crystal.
      lantern.position.set(.85, 0, -.30); table.candles[2].add(lantern);
      lighting = createWizardLighting({ THREE, scene: table.scene, renderer: table.renderer, camera: table.camera,
        candles, orb, lantern: { root: lantern, glass: lanternGlass },
        legacyLights: table.legacyLights, shadows: false });
    } catch (error) {
      lighting?.dispose();
      swaps.forEach(([wrapper], i) => { wrapper.clear(); wrapper.add(...priorChildren[i]); });
      throw error;
    }
    this.retired.push(...table.tableSurface, ...priorChildren.flat());
    for (const surface of table.tableSurface) table.scene.remove(surface);
    table.scene.add(frame, felt);
    table.tableSurface = [frame, felt]; table.orb = orb;
    table.assetLighting = lighting;
    this.candles = candles; this.corners = corners;
  }
  update(options) {
    if (this.disposed) return;
    if (this.corners) this.corners.visible = !options.lowPower;
    return this.table.assetLighting?.update(options);
  }
  dispose(textures = []) {
    if (this.disposed) return;
    this.disposed = true; this.status = 'disposed';
    this.table.assetLighting?.dispose();
    this.table.assetLighting = null;
    this.library.dispose([this.table.scene, ...this.retired], textures);
    this.retired = [];
  }
}
