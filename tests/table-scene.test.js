import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCardFace, preloadCardFaces } from '../src/card-face.js';
import * as THREE from 'three';

test('flat played cards use a physical edge, unlit art, and the rule engine leader without an elevated shadow caster',async t=>{
  const original=globalThis.matchMedia;
  globalThis.matchMedia=()=>({matches:false});
  t.after(()=>{if(original)globalThis.matchMedia=original;else delete globalThis.matchMedia;});
  const {TableScene}=await import('../src/table-scene.js');
  const scene={cards:new Map(),scene:new THREE.Scene(),mode:'game',material:TableScene.prototype.material,mesh:TableScene.prototype.mesh,face:()=>null};
  const entries=[{player:0,card:{id:'a',kind:'number',suit:'red',rank:2}},{player:1,card:{id:'b',kind:'number',suit:'red',rank:8}}];
  TableScene.prototype.updateCards.call(scene,entries,{phase:'play',trick:entries,trump:'blue',options:{deckMode:'standard'}});
  for(const group of scene.cards.values())for(const mesh of [group.userData.face,group.userData.edge]) {
    assert.equal(mesh.castShadow,false);assert.equal(mesh.receiveShadow,false);
  }
  for(const [id,group] of scene.cards) {
    assert.equal(group.rotation.x,0);
    assert.equal(group.userData.target.y,.382);
    assert.equal(group.userData.face.rotation.x,-Math.PI/2);
    assert.equal(group.userData.face.material.isMeshBasicMaterial,true);
    assert.equal(group.userData.rim.visible,id==='b');
  }
  assert.equal(scene.cards.size,2);
});

test('gold rim follows Wizard, Jester, trump, led-suit and mono ties after every play',async t=>{
  const original=globalThis.matchMedia;
  globalThis.matchMedia=()=>({matches:false});
  t.after(()=>{if(original)globalThis.matchMedia=original;else delete globalThis.matchMedia;});
  const {TableScene}=await import('../src/table-scene.js');
  const n=(suit,rank)=>({kind:'number',suit,rank}),w={kind:'wizard'},j={kind:'jester'};
  for(const [cards,leaders,trump,deckMode] of [
    [[j,n('red',2),n('green',13),n('blue',1)],[0,1,1,3],'blue','standard'],
    [[n('red',13),w,w,n('blue',13)],[0,1,1,1],'blue','standard'],
    [[j,j,j],[0,0,0],null,'standard'],
    [[n('red',4),n('red',9),j,n('green',13)],[0,1,1,1],null,'standard'],
    [[n('red',4),n('blue',13),n('green',13),w],[0,1,1,3],null,'mono'],
  ]) {
    const scene={cards:new Map(),scene:new THREE.Scene(),mode:'game',material:TableScene.prototype.material,mesh:TableScene.prototype.mesh,face:()=>null};
    const entries=cards.map((card,player)=>({player,card:{...card,id:`card-${player}`}}));
    for(let count=1;count<=entries.length;count++) {
      const trick=entries.slice(0,count);
      TableScene.prototype.updateCards.call(scene,trick,{phase:'play',trick,trump,options:{deckMode}});
      const highlighted=[...scene.cards.values()].filter(group=>group.userData.rim.visible);
      assert.equal(highlighted.length,1);assert.equal(highlighted[0].userData.player,leaders[count-1]);
      for(const group of scene.cards.values())assert.equal(group.userData.target.y,.382);
    }
  }
});

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
