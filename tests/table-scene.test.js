import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCardFace, preloadCardFaces } from '../src/card-face.js';
import * as THREE from 'three';
import { SpecialFigurines } from '../src/rendering/special-figurines.mjs';

test('flat played cards use a physical edge, unlit art, and the rule engine leader without an elevated shadow caster',async t=>{
  const original=globalThis.matchMedia;
  globalThis.matchMedia=()=>({matches:false});
  t.after(()=>{if(original)globalThis.matchMedia=original;else delete globalThis.matchMedia;});
  const {TableScene}=await import('../src/table-scene.js');
  const scene={cards:new Map(),figurines:new SpecialFigurines(),scene:new THREE.Scene(),mode:'game',material:TableScene.prototype.material,mesh:TableScene.prototype.mesh,face:()=>null};
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
    assert.equal(group.userData.rimBack.visible,id==='b');
    assert.equal(group.userData.rim.material.color.getHexString(),'9cefff');
    assert.equal(group.userData.rimBack.material.color.getHexString(),'102636');
  }
  assert.equal(scene.cards.size,2);
});

test('high-contrast rim follows Wizard, Jester, trump, led-suit and mono ties after every play',async t=>{
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
    const scene={cards:new Map(),figurines:new SpecialFigurines(),scene:new THREE.Scene(),mode:'game',material:TableScene.prototype.material,mesh:TableScene.prototype.mesh,face:()=>null};
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
  const initialVersion = first.version;
  assert.ok(initialVersion > 0); assert.equal(second.version, initialVersion); assert.equal(disposed.version, initialVersion);
  const failed = loadCardFace(card); images[0].onerror();
  await assert.rejects(failed, /加载失败/);
  assert.equal(first.userData.faceReady, false); assert.equal(first.version, initialVersion);
  assert.equal(second.userData.faceReady, false); assert.equal(second.version, initialVersion);

  // A waiting-stage preload is the only action after failure: no scene.face()
  // call, render-loop scan or unconditional texture upload can hide the bug.
  await preloadCardFaces();
  assert.equal(first.userData.faceReady, true); assert.equal(first.version, initialVersion + 1);
  assert.equal(second.userData.faceReady, true); assert.equal(second.version, initialVersion + 1);
  assert.equal(disposed.userData.faceReady, false); assert.equal(disposed.version, initialVersion);
  assert.equal(firstScene.draws, 1); assert.equal(secondScene.draws, 1); assert.equal(disposedScene.draws, 0);
  await preloadCardFaces(); await loadCardFace(card);
  assert.equal(first.version, initialVersion + 1); assert.equal(second.version, initialVersion + 1);
});

test('mobile candle footprints retain their 21/24 px budget instead of shrinking twice', async t => {
  const original=globalThis.matchMedia;globalThis.matchMedia=()=>({matches:false});
  t.after(()=>{if(original)globalThis.matchMedia=original;else delete globalThis.matchMedia;});
  const {TableScene}=await import('../src/table-scene.js');
  for (const [width,height,compact] of [[844,390,true],[667,275,true],[1024,460,true],[390,844,false]]) {
    const camera=new THREE.PerspectiveCamera(compact?32:43,width/height,.1,80);
    camera.position.set(0,8.48,5.3);camera.lookAt(0,0,0);camera.updateProjectionMatrix();camera.updateMatrixWorld();
    const candles=Array.from({length:4},()=>new THREE.Group());
    const props=Array.from({length:4},()=>new THREE.Group());
    const scene={mode:'game',camera,candles,book:props[0],orbStand:props[1],deck:props[2],coins:props[3],
      host:{closest:()=>({dataset:{layoutMode:compact?'strip':'ring'}})},trumpRingMaterial:{},
      tableProps:[...candles,...props].map(group=>({group,position:group.position.clone(),scale:group.scale.clone()}))};
    TableScene.prototype.layoutDecorations.call(scene,width,height);
    for(const candle of candles){
      const p=new THREE.Vector3(candle.position.x,.36,candle.position.z);
      const a=p.clone().project(camera),b=p.clone().add(new THREE.Vector3(.78*candle.scale.x,0,0)).project(camera);
      const pixels=Math.abs(b.x-a.x)*width/2;
      assert.ok(Math.abs(pixels-(compact?24:21))<1e-7,`${width}x${height}: ${pixels}`);
    }
    if(compact) { assert.equal(props[1].visible,true,'high quality retains the crystal'); assert.ok([props[0],props[2],props[3]].every(p=>!p.visible)); }
  }
});

test('larger miniatures land on their own card and survive shared-geometry card removal', async t => {
  const original=globalThis.matchMedia;globalThis.matchMedia=()=>({matches:false});
  t.after(()=>{if(original)globalThis.matchMedia=original;else delete globalThis.matchMedia;});
  const {TableScene}=await import('../src/table-scene.js');
  const {TableMotion}=await import('../src/table-motion.js');
  const scene={cards:new Map(),figurines:new SpecialFigurines(),scene:new THREE.Scene(),mode:'game',
    material:TableScene.prototype.material,mesh:TableScene.prototype.mesh,face:()=>null,motion:new TableMotion(()=>1000)};
  const entries=[0,1].map(player=>({player,card:{id:`wizard-${player}`,kind:'wizard'}}));
  const state={phase:'play',round:1,completedTricks:0,trick:entries,trump:null,events:[],options:{deckMode:'standard'}};
  scene.motion.sync(state,{initial:true,serverNow:1000});
  TableScene.prototype.updateCards.call(scene,entries,state);
  for(const group of scene.cards.values()){
    const d=group.userData;d.from=d.target.clone();d.baseScale=new THREE.Vector3(.5,.5,.5);
    d.collectTo=new THREE.Vector3(2,.382,0);d.liftPerPixel=.02;
  }
  TableScene.prototype.drawCards.call(scene,scene.motion.snapshot());
  for(const group of scene.cards.values()){
    const figure=group.userData.figurine;assert.equal(figure.parent,group);assert.equal(figure.visible,true);
    assert.equal(figure.position.z,.10);assert.equal(figure.position.y,.027);assert.equal(figure.scale.x,.8);
    group.updateWorldMatrix(true,true);
    const feet=new THREE.Box3().setFromObject(figure).min.y;
    const faceY=group.userData.face.getWorldPosition(new THREE.Vector3()).y;
    assert.ok(feet>faceY&&feet-faceY<.01,'feet sit just above the actual face');
  }
  const geometry=scene.cards.get('wizard-1').userData.figurine.geometry;let disposed=0;
  geometry.addEventListener('dispose',()=>disposed++);
  TableScene.prototype.updateCards.call(scene,entries.slice(1),state);
  assert.equal(disposed,0);assert.equal(scene.cards.get('wizard-1').userData.figurine.geometry,geometry);
  TableScene.prototype.updateCards.call(scene,[],state);assert.equal(disposed,0);
  scene.figurines.dispose();assert.equal(disposed,1);
});
