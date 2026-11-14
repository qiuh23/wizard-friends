import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { adaptiveTablePlaySlots, tableLayoutMode, tableLayoutFits, tableOverlayReserve } from '../src/table-layout.js';
import { frameTableCamera, projectedFeltBounds } from '../src/rendering/table-framing.mjs';

// These are explicit offline geometry fixtures, not claimed browser measures.
// Both actual Three.js alignment and the CSS perspective transform are tested.
const viewports=[[320,568],[360,640],[390,844],[430,932],[568,320],[667,275],[667,375],[844,390],[932,430],[1440,900],[1024,768],[1280,720]];
function fixture(width,height,count) {
  const strip=tableLayoutMode(width,height)==='strip';
  const camera=new THREE.PerspectiveCamera();frameTableCamera(camera,width,height,{compact:strip});
  const physical=projectedFeltBounds(camera,width,height);
  const area={left:Math.max(10,physical.left+8),right:Math.min(width-10,physical.right-8),
    top:Math.max(strip?(height<=340?110:120):height<700?154:194,physical.top+8),bottom:Math.min(height-8,physical.bottom-8)};
  const obstacles=strip?[
    {left:8,right:153,top:height-110,bottom:height},
    {left:164,right:width-190,top:height-(height<=340?80:92),bottom:height},
    {left:width-184,right:width-8,top:height-104,bottom:height},
  ]:[{left:10,right:width-10,top:height-278,bottom:height}];
  const seats=Array.from({length:count},(_,i)=>({id:`p${i}`}));
  const layout=adaptiveTablePlaySlots(area,seats,obstacles);
  return {camera,area,obstacles,seats,layout};
}

test('full tricks remain on real felt and clear of docks in both physical and CSS projections',async t=>{
  const original=globalThis.matchMedia;globalThis.matchMedia=()=>({matches:false});
  t.after(()=>{if(original)globalThis.matchMedia=original;else delete globalThis.matchMedia;});
  const {TableScene}=await import('../src/table-scene.js');
  for(const [width,height]of viewports)for(let count=3;count<=6;count++) {
    const {camera,area,obstacles,seats,layout}=fixture(width,height,count);
    assert.ok(layout,`${width}×${height}/${count}: available layout`);
    assert.ok(tableLayoutFits(layout,area,obstacles));
    const nodes=seats.map(seat=>{
      const slot=layout.slots.get(seat.id),w=layout.width;
      return {getBoundingClientRect:()=>slot.rect,querySelector:()=>({offsetLeft:(slot.rect.right-slot.rect.left-w)/2,
        offsetTop:4-w*.08,offsetWidth:w,offsetHeight:1.5*w}),style:{getPropertyValue:name=>name==='--table-angle'?String(slot.angle):'0'}};
    });
    const table={querySelector:selector=>nodes[Number(selector.match(/(?:seat="|player="p)(\d+)/)?.[1]||0)]};
    const cards=new Map(seats.map((seat,index)=>{const group=new THREE.Group();group.userData={player:index,target:new THREE.Vector3()};return[seat.id,group];}));
    const scene={state:{players:seats},viewer:'p0',camera,cards,host:{closest:()=>table},
      renderer:{domElement:{getBoundingClientRect:()=>({left:0,top:0,width,height})}}};
    TableScene.prototype.alignCardSeats.call(scene);
    for(const [index,seat]of seats.entries()) {
      const group=cards.get(seat.id),slot=layout.slots.get(seat.id),w=layout.width;
      for(const emphasis of [1,1.025]) {
        const points=[];
        for(const x of [-.55,.55])for(const z of [-.83,.83]) {
          const p=new THREE.Vector3(x,.024,z).applyAxisAngle(new THREE.Vector3(0,1,0),group.userData.rotation)
            .multiplyScalar(group.scale.x*emphasis).add(group.userData.target).project(camera);
          points.push({x:(p.x+1)*width/2,y:(1-p.y)*height/2});
        }
        const box={left:Math.min(...points.map(p=>p.x)),right:Math.max(...points.map(p=>p.x)),top:Math.min(...points.map(p=>p.y)),bottom:Math.max(...points.map(p=>p.y))};
        assert.ok(box.left>=slot.rect.left&&box.right<=slot.rect.right&&box.top>=slot.rect.top&&box.bottom<=slot.rect.bottom-28,
          `${width}×${height}/${count}/${index} 3D face leaves its reserved face/owner/status slot: ${JSON.stringify({box,slot:slot.rect,w})}`);
        const cx=slot.x,cy=slot.rect.top+4+w*.67, angle=THREE.MathUtils.degToRad(slot.angle),pitch=THREE.MathUtils.degToRad(32);
        for(const x of [-w/2,w/2])for(const y of [-w*.75,w*.75]) {
          const rx=(x*Math.cos(angle)-y*Math.sin(angle))*emphasis;
          const ry=(x*Math.sin(angle)+y*Math.cos(angle))*emphasis;
          const perspective=900/(900-ry*Math.sin(pitch));
          const px=cx+rx*perspective,py=cy+ry*Math.cos(pitch)*perspective;
          assert.ok(px>=slot.rect.left&&px<=slot.rect.right&&py>=slot.rect.top&&py<=slot.rect.bottom-28,
            `${width}×${height}/${count}/${index} CSS face leaves slot ${JSON.stringify({px,py,slot:slot.rect,w,emphasis})}`);
        }
      }
    }
  }
});


test('expanded-hand normal anchors recover on fresh mount, rotate and collapse without cached destinations',()=>{
  for(const [width,height]of [...viewports,[768,1024]])for(let count=3;count<=6;count++) {
    const strip=tableLayoutMode(width,height)==='strip';
    const camera=new THREE.PerspectiveCamera();frameTableCamera(camera,width,height,{compact:strip});
    const physical=projectedFeltBounds(camera,width,height);
    const area={left:Math.max(10,physical.left+8),right:Math.min(width-10,physical.right-8),
      top:Math.max(strip?(height<=340?110:120):height<700?154:194,physical.top+8),
      bottom:Math.min(height-tableOverlayReserve(width,height),physical.bottom-8)};
    const seats=Array.from({length:count},(_,i)=>({id:`p${i}`}));
    const overlay=adaptiveTablePlaySlots(area,seats);
    assert.ok(overlay,`${width}×${height}/${count} expanded fresh mount`);
    assert.ok(tableLayoutFits(overlay,area));
    assert.deepEqual(adaptiveTablePlaySlots(area,seats),overlay,'rotation/remount does not require a previous layout');
    // Closing returns to the ordinary measured-dock policy, not overlay anchors.
    const normal=fixture(width,height,count);
    assert.ok(normal.layout);assert.ok(tableLayoutFits(normal.layout,normal.area,normal.obstacles));
  }
});
