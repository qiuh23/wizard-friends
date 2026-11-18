import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import * as THREE from 'three';
import { frameTableCamera } from '../src/rendering/table-framing.mjs';

const source = readFileSync(new URL('../src/table-scene.js', import.meta.url), 'utf8');
const resizeSource = source.slice(source.indexOf('  resize() {'), source.indexOf('    this.updateAssetLighting();', source.indexOf('  resize() {')));
let viewport = [1440,900];
const resize = runInNewContext(`({${resizeSource}}}).resize`, {
  updateDrawingBuffer() {}, frameTableCamera, globalThis: { devicePixelRatio: 1 }, performance: { now: () => 0 },
  matchMedia(query) { assert.equal(query,'(max-width:700px) and (orientation:portrait)'); return {matches:viewport[0]<=700&&viewport[1]>viewport[0]}; },
});
function sceneFor(width,height,{lobby=false,game=false,compact=false}={}) {
  return {mode:game?'game':'hero',lobby,foresight:false,camera:new THREE.PerspectiveCamera(43,1,.1,80),
    host:{getBoundingClientRect:()=>({width,height}),closest:()=>game?{dataset:{layoutMode:compact?'strip':'ring'}}:null},
    trump:new THREE.Object3D(),tableSurface:[new THREE.Object3D()],tableInlay:new THREE.Object3D(),
    surround:Object.assign(new THREE.Object3D(),{visible:game}),trumpRingMaterial:{},layoutDecorations(){}};
}
function centered(camera,width,height) {
  for(const y of [0,.36,.43])assert.ok(Math.abs(new THREE.Vector3(0,y,0).project(camera).x)<1e-10,`${width}×${height}: table center shifted`);
  assert.ok(Math.abs(new THREE.Vector3(-3,.36,0).project(camera).x+new THREE.Vector3(3,.36,0).project(camera).x)<1e-10);
}

test('desktop and landscape home retain their centered camera and three-card transform',()=>{
  for(const [width,height] of [[1440,900],[1100,800],[800,700],[844,390],[701,900],[1440,900]]) {
    viewport=[width,height];const scene=sceneFor(width,height),{camera}=scene;
    camera.setViewOffset(width,height,-width*.28,0,width,height);
    resize.call(scene);centered(camera,width,height);
    assert.deepEqual(camera.position.toArray(),[0,7.3,10.2]);assert.equal(camera.fov,43);assert.equal(camera.view.enabled,false);
    assert.equal(scene.homePortrait,false);assert.equal(scene.surround.visible,false);
    assert.deepEqual(scene.trump.position.toArray(),[0,1.9,0]);assert.equal(scene.trump.scale.x,1.5);
  }
});

test('phone home restores the exact original oblique hero camera without zoom or offset',()=>{
  for(const [width,viewportHeight] of [[320,480],[320,568],[360,640],[390,568],[390,844],[430,932],[600,700],[700,701]]) {
    viewport=[width,viewportHeight];const height=viewportHeight-200,scene=sceneFor(width,height),expected=new THREE.PerspectiveCamera(43,1,.1,80);
    resize.call(scene);expected.aspect=width/height;expected.position.set(0,7.3,10.2);expected.lookAt(0,0,0);expected.updateProjectionMatrix();expected.updateMatrixWorld();centered(scene.camera,width,height);
    assert.equal(scene.homePortrait,true);assert.equal(scene.surround.visible,false);
    assert.deepEqual(scene.camera.position.toArray(),expected.position.toArray());
    assert.deepEqual(scene.camera.quaternion.toArray(),expected.quaternion.toArray());
    assert.deepEqual(scene.camera.projectionMatrix.elements,expected.projectionMatrix.elements);
    assert.equal(scene.mode,'hero');assert.equal(scene.trump.userData.baseHeight,1.9);assert.equal(scene.trump.scale.x,1.5);assert.deepEqual(scene.trump.position.toArray(),[0,1.9,0]);
  }
});

test('lobby and all live-game cameras retain their previous framing',()=>{
  viewport=[390,844];const lobby=sceneFor(390,644,{lobby:true});resize.call(lobby);
  assert.equal(lobby.homePortrait,false);assert.deepEqual(lobby.camera.position.toArray(),[0,7.3*1.4,10.2*1.4]);
  assert.deepEqual(lobby.trump.position.toArray(),[0,1.9,0]);assert.equal(lobby.trump.scale.x,1.5);
  for(const [width,height,compact] of [[390,844,false],[844,390,true],[1440,900,false]]) {
    viewport=[width,height];const scene=sceneFor(width,height,{game:true,compact}),expected=new THREE.PerspectiveCamera(43,1,.1,80);
    resize.call(scene);frameTableCamera(expected,width,height,{compact});
    assert.equal(scene.homePortrait,false);assert.deepEqual(scene.camera.matrixWorld.elements,expected.matrixWorld.elements);
    assert.deepEqual(scene.camera.projectionMatrix.elements,expected.projectionMatrix.elements);
  }
});

test('orientation changes reset home presentation and invalidate even an unchanged canvas',()=>{
  const scene=sceneFor(390,368);
  viewport=[390,568];resize.call(scene);const portraitKey=scene.layoutKey;
  viewport=[844,390];resize.call(scene);assert.notEqual(scene.layoutKey,portraitKey);
  assert.equal(scene.homePortrait,false);assert.equal(scene.surround.visible,false);
  assert.deepEqual(scene.camera.position.toArray(),[0,7.3,10.2]);assert.deepEqual(scene.trump.position.toArray(),[0,1.9,0]);
  viewport=[390,568];resize.call(scene);assert.equal(scene.layoutKey,portraitKey);assert.equal(scene.trump.scale.x,1.5);
});

test('all three original home card meshes remain in canvas throughout a full turn and bob',async()=>{
  const original=globalThis.matchMedia;globalThis.matchMedia=()=>({matches:false});
  const {TableScene}=await import('../src/table-scene.js');
  if(original)globalThis.matchMedia=original;else delete globalThis.matchMedia;
  for(const [width,viewportHeight] of [[320,480],[320,568],[360,640],[390,568],[390,844],[430,932],[600,700],[700,701]]) {
    viewport=[width,viewportHeight];const height=viewportHeight-200,scene=sceneFor(width,height);
    Object.assign(scene,{scene:new THREE.Scene(),cards:new Map(),material:TableScene.prototype.material,mesh:TableScene.prototype.mesh,face:()=>null});
    TableScene.prototype.buildTrump.call(scene);resize.call(scene);
    TableScene.prototype.updateCards.call(scene,[{player:0,card:{id:'sample-blue',kind:'number',suit:'blue',rank:13}},{player:1,card:{id:'sample-red',kind:'number',suit:'red',rank:7}}]);
    assert.equal(scene.cards.size,2);assert.equal(scene.trump.children.length,1);
    for(const [i,card] of [...scene.cards.values()].entries()) {
      assert.deepEqual(card.userData.target.toArray(),[i===0?-1.55:1.55,.43,.65]);
      card.position.copy(card.userData.target);card.rotation.y=card.userData.rotation;
    }
    const check=root=>{
      root.updateWorldMatrix(true,true);
      root.traverseVisible(mesh=>{
        if(!mesh.isMesh)return;mesh.geometry.computeBoundingBox();const box=mesh.geometry.boundingBox;
        for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z]) {
          const p=new THREE.Vector3(x,y,z).applyMatrix4(mesh.matrixWorld).project(scene.camera),px=(p.x+1)*width/2,py=(1-p.y)*height/2;
          assert.ok(px>=8&&px<=width-8,`${width}×${viewportHeight}: card side clipped at ${px}`);
          assert.ok(py>=0&&py<=height-12,`${width}×${viewportHeight}: canvas/menu collision at ${py}`);
        }
      });
    };
    for(const card of scene.cards.values())check(card);
    for(let step=0;step<128;step++)for(const bob of [-.07,0,.07]) {
      scene.trumpCard.rotation.y=step*Math.PI/64;scene.trump.position.y=scene.trump.userData.baseHeight+bob;check(scene.trump);
      assert.ok(new THREE.Box3().setFromObject(scene.trump).min.y>.36,'floating card stays above felt');
    }
  }
});

test('same-size home reattachment retains original hero camera and atmosphere',async()=>{
  const original=globalThis.matchMedia;globalThis.matchMedia=()=>({matches:false});
  const {TableScene}=await import('../src/table-scene.js');
  if(original)globalThis.matchMedia=original;else delete globalThis.matchMedia;
  viewport=[320,568];const scene=sceneFor(320,368);
  Object.assign(scene,{key:'hero',cards:new Map(),updateTrump(){},resize(){resize.call(this);}});
  scene.trumpRingMaterial.color={set(){}};
  resize.call(scene);const key=scene.layoutKey;
  for(let i=0;i<4;i++) {
    TableScene.prototype.attach.call(scene,scene.host,null);
    assert.equal(scene.layoutKey,key);assert.equal(scene.surround.visible,false);assert.equal(scene.trumpRingMaterial.opacity,.35);assert.deepEqual(scene.camera.position.toArray(),[0,7.3,10.2]);
  }
});

test('portrait home keeps one rotating wizard and honors reduced motion',()=>{
  const motionMedia={matches:false};
  const animate=runInNewContext(`({${source.slice(source.indexOf('  animate(time) {'),source.lastIndexOf('\n}'))}}).animate`,{THREE,motionMedia,document:{hidden:false}});
  const scene={mode:'hero',homePortrait:true,host:{isConnected:true},trumpMotion:true,assetLighting:{},dust:new THREE.Object3D(),orb:new THREE.Object3D(),
    trump:new THREE.Object3D(),trumpCard:new THREE.Object3D(),cards:new Map(),updateAssetLighting(){},renderer:{render(){}}};
  scene.trump.userData.baseHeight=1.9;
  for(const time of [1000,3000,8000,16000]) {
    scene.frame=time;scene.animationTime=time;animate.call(scene,time);
    assert.equal(scene.trumpCard.rotation.y,-.25+time*.001*Math.PI/8);
    assert.equal(scene.dust.visible,true);assert.ok(Math.abs(scene.trump.position.y-1.9)<=.07);
  }
  motionMedia.matches=true;assert.equal(animate.call(scene,17000),null);
  assert.equal(scene.trumpCard.rotation.y,-.25);assert.equal(scene.trump.position.y,1.9);
});
