import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { frameTableCamera, projectedFeltBounds, TABLE_FELT } from '../src/rendering/table-framing.mjs';

test('physical table camera preserves angle, circular inlay and useful felt bounds across aspect ratios',()=>{
  for(const [width,height] of [[320,568],[360,640],[390,844],[430,932],[568,320],[667,275],[740,320],[844,390],[932,430],[1440,900]]) {
    const camera=new THREE.PerspectiveCamera(43,width/height,.1,80),compact=width>height&&height<500;
    frameTableCamera(camera,width,height,{compact});
    const forward=camera.getWorldDirection(new THREE.Vector3());
    assert.ok(Math.abs(Math.asin(-forward.y)*180/Math.PI-58)<1e-8);
    const bounds=projectedFeltBounds(camera,width,height);
    assert.ok(bounds.right-bounds.left>width*.48);
    assert.ok(bounds.bottom-bounds.top>Math.min(width*.7,height*.5));
    for(let i=0;i<64;i++) {
      const a=i*Math.PI/32,p=new THREE.Vector3(2.8*Math.cos(a),.36,2.8*Math.sin(a)).project(camera);
      assert.ok(Math.abs(p.x)<1&&Math.abs(p.y)<1,`${width}×${height} inlay clipped`);
    }
    const ray=new THREE.Raycaster(),plane=new THREE.Plane(new THREE.Vector3(0,1,0),-TABLE_FELT.y);
    for(const x of [bounds.left+.01,bounds.right-.01])for(const y of [bounds.top+.01,bounds.bottom-.01]) {
      ray.setFromCamera(new THREE.Vector2(x/width*2-1,1-y/height*2),camera);
      const p=ray.ray.intersectPlane(plane,new THREE.Vector3());
      assert.ok(Math.abs(p.x)<=TABLE_FELT.halfWidth+.001&&Math.abs(p.z)<=TABLE_FELT.halfDepth+.001);
    }
  }
});
