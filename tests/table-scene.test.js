import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCardFace, preloadCardFaces } from '../src/card-face.js';

test('background face retry updates every existing GPU texture without another face lookup', async t => {
  const originals = new Map(['Image', 'document', 'matchMedia'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  t.after(() => {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  });
  const images = [];
  globalThis.Image = class {
    constructor() { images.push(this); }
    set src(url) {
      this.url = url;
      if (images.length > 1) queueMicrotask(() => this.onload());
    }
    async decode() {}
  };
  globalThis.document = {createElement() {
    const ctx = {
      fillRect() {}, strokeRect() {}, beginPath() {}, arc() {}, fill() {}, fillText() {}, drawImage() {},
      measureText() { return {actualBoundingBoxAscent:20,actualBoundingBoxDescent:0,actualBoundingBoxLeft:0,actualBoundingBoxRight:20}; },
    };
    return {getContext() { return ctx; }};
  }};
  globalThis.matchMedia = () => ({matches:false});
  const {TableScene} = await import('../src/table-scene.js');
  const scene = () => ({textures:new Map(),draws:0,requestDraw() { this.draws++; },renderer:{capabilities:{getMaxAnisotropy:()=>4}}});
  const card = {kind:'number',suit:'green',rank:13};
  const firstScene = scene(), secondScene = scene(), disposedScene = scene();
  const first = TableScene.prototype.face.call(firstScene,card);
  const second = TableScene.prototype.face.call(secondScene,card);
  const disposed = TableScene.prototype.face.call(disposedScene,card); disposed.dispose();
  assert.equal(first.image, second.image); assert.equal(images.length, 1);
  const failed = loadCardFace(card); images[0].onerror();
  await assert.rejects(failed, /加载失败/);
  assert.equal(first.userData.faceReady, false); assert.equal(first.version, 1);
  assert.equal(second.userData.faceReady, false); assert.equal(second.version, 1);

  // A waiting-stage preload is the only action after failure: no scene.face()
  // call, render-loop scan or unconditional texture upload can hide the bug.
  await preloadCardFaces();
  assert.equal(first.userData.faceReady, true); assert.equal(first.version, 2);
  assert.equal(second.userData.faceReady, true); assert.equal(second.version, 2);
  assert.equal(disposed.userData.faceReady, false); assert.equal(disposed.version, 1);
  assert.equal(firstScene.draws, 1); assert.equal(secondScene.draws, 1); assert.equal(disposedScene.draws, 0);
  await preloadCardFaces(); await loadCardFace(card);
  assert.equal(first.version, 2); assert.equal(second.version, 2);
});
