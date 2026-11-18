import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import * as THREE from 'three';

const source = readFileSync(new URL('../src/table-scene.js', import.meta.url), 'utf8');
const resizeSource = source.slice(source.indexOf('  resize() {'), source.indexOf('    this.updateAssetLighting();', source.indexOf('  resize() {')));
const resize = runInNewContext(`({${resizeSource}}}).resize`, { updateDrawingBuffer() {}, globalThis: { devicePixelRatio: 1 }, performance: { now: () => 0 } });

test('home table stays on the horizontal centerline at desktop and portrait widths, including resize', () => {
  const camera = new THREE.PerspectiveCamera(43, 1, .1, 80);
  for (const [width, height] of [[1440,900],[1100,800],[800,700],[390,644],[320,368],[844,390],[1440,900]]) {
    // Start with the previous side-composition camera, to test that resize clears it.
    camera.setViewOffset(width,height,-width*.28,0,width,height);
    const scene = { mode:'hero', lobby:false, camera, host:{getBoundingClientRect:()=>({width,height}), closest:()=>null},
      trump:new THREE.Object3D(), tableSurface:[new THREE.Object3D()], tableInlay:new THREE.Object3D(), layoutDecorations() {} };
    resize.call(scene);
    for (const y of [0,.36,.43]) assert.ok(Math.abs(new THREE.Vector3(0,y,0).project(camera).x)<1e-10,`${width}×${height}: table center shifted`);
    const left=new THREE.Vector3(-3,.36,0).project(camera).x;
    const right=new THREE.Vector3(3,.36,0).project(camera).x;
    assert.ok(Math.abs(left+right)<1e-10);
    assert.deepEqual(camera.position.toArray(),[0,7.3,10.2]);
    assert.equal(camera.fov,43);
    assert.equal(camera.view.enabled,false);
  }
});

test('lobby portrait retains its existing camera distance',()=>{
  const camera=new THREE.PerspectiveCamera(43,1,.1,80);
  resize.call({mode:'hero',lobby:true,camera,host:{getBoundingClientRect:()=>({width:390,height:644}),closest:()=>null},trump:new THREE.Object3D(),tableSurface:[],tableInlay:new THREE.Object3D(),layoutDecorations(){}});
  assert.deepEqual(camera.position.toArray(),[0,7.3*1.4,10.2*1.4]);
});
