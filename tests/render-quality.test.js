import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { isPhoneRenderTarget, drawingBufferPlan, updateDrawingBuffer, configureCardSampling, PHONE_PIXEL_BUDGET } from '../src/rendering/render-quality.mjs';

test('only phone-sized touch screens gain density, in either orientation, independent of table or keyboard size',()=>{
  for(const [width,height] of [[320,568],[390,844],[430,932],[480,1040]]) {
    assert.equal(isPhoneRenderTarget({coarse:true,width,height}),true);
    assert.equal(isPhoneRenderTarget({coarse:true,width:height,height:width}),true);
    assert.equal(isPhoneRenderTarget({coarse:false,width,height}),false);
  }
  for(const [width,height] of [[600,960],[768,1024],[1024,768],[1440,900],[3840,2160]])
    assert.equal(isPhoneRenderTarget({coarse:true,width,height,innerHeight:300,tableHeight:200}),false);
  assert.equal(isPhoneRenderTarget(),false);
});

test('high-quality phones gain native 3× sampling without changing CSS or scene projection',()=>{
  for(const [width,height]of [[320,568],[360,640],[390,844],[430,932],[844,390],[932,430]]) {
    const plan=drawingBufferPlan({width,height,devicePixelRatio:3,phone:true});
    assert.equal(plan.width,width);assert.equal(plan.height,height);assert.equal(plan.ratio,3);
    assert.equal(plan.bufferWidth,width*3);assert.equal(plan.bufferHeight,height*3);
    assert.equal(plan.bufferWidth*plan.bufferHeight/(width*height*4),2.25);
    assert.ok(plan.bufferWidth*plan.bufferHeight<=PHONE_PIXEL_BUDGET);
  }
});

test('high phone has a finite 4M ceiling; desktop, tablet and explicit low retain former 2× defaults',()=>{
  for(const devicePixelRatio of [.75,1,1.5,2,3,4])for(const [width,height]of [[390,844],[480,1040],[600,1200],[768,1024],[1440,900],[2560,1440],[3840,2160]]) {
    const desktop=drawingBufferPlan({width,height,devicePixelRatio});
    const low=drawingBufferPlan({width,height,devicePixelRatio,phone:true,low:true});
    assert.equal(desktop.ratio,Math.min(2,devicePixelRatio));assert.deepEqual(low,desktop);
    assert.deepEqual(drawingBufferPlan({width,height,devicePixelRatio,maxDimension:1024}),desktop);
    assert.deepEqual(drawingBufferPlan({width,height,devicePixelRatio,phone:true,low:true,maxDimension:1024}),low);
    const high=drawingBufferPlan({width,height,devicePixelRatio,phone:true});
    assert.ok(high.ratio<=Math.min(3,devicePixelRatio));
    assert.ok(high.bufferWidth*high.bufferHeight<=PHONE_PIXEL_BUDGET);
    if(width*height*4<=PHONE_PIXEL_BUDGET)assert.ok(high.ratio>=low.ratio);
  }
  const limited=drawingBufferPlan({width:430,height:932,devicePixelRatio:3,phone:true,maxDimension:2048});
  assert.ok(limited.bufferHeight<=2048);assert.ok(limited.bufferWidth<=2048);
  assert.equal(drawingBufferPlan({width:0,height:100}),null);
  assert.equal(drawingBufferPlan({width:Infinity,height:100}),null);
  assert.equal(drawingBufferPlan({width:100,height:100,devicePixelRatio:NaN}).ratio,1);
});

test('density, rotation and quality changes allocate one drawing buffer; identical layout requests allocate none',()=>{
  const calls=[],renderer={setDrawingBufferSize(...args){calls.push(args);},setPixelRatio(){throw Error('double allocation');},setSize(){throw Error('double allocation');}};
  const options={width:390,height:844,devicePixelRatio:3,phone:true};
  assert.equal(updateDrawingBuffer(renderer,options),true);assert.deepEqual(calls,[[390,844,3]]);
  for(let i=0;i<120;i++)assert.equal(updateDrawingBuffer(renderer,options),false);
  assert.equal(calls.length,1);
  updateDrawingBuffer(renderer,{...options,width:844,height:390});assert.equal(calls.length,2);
  updateDrawingBuffer(renderer,{...options,devicePixelRatio:2});assert.equal(calls.length,3);
  updateDrawingBuffer(renderer,{...options,low:true});assert.equal(calls.length,3,'same dimensions and resolved density reuse allocation');
  updateDrawingBuffer(renderer,options);assert.equal(calls.length,4);
});

test('phone card textures gain capped anisotropy with stable mipmaps; desktop/low stay unchanged and repeats do not upload',()=>{
  for(const maximum of [0,1,2,4,8,16]) {
    const texture=new THREE.Texture();
    configureCardSampling(texture,{phone:true,maxAnisotropy:maximum});
    assert.equal(texture.anisotropy,Math.max(1,Math.min(8,maximum)));
    assert.equal(texture.generateMipmaps,true);
    assert.equal(texture.minFilter,THREE.LinearMipmapLinearFilter);assert.equal(texture.magFilter,THREE.LinearFilter);
    const version=texture.version;
    assert.equal(configureCardSampling(texture,{phone:true,maxAnisotropy:maximum}),false);assert.equal(texture.version,version);
    for(const options of [{phone:true,low:true},{phone:false,low:false}]) {
      configureCardSampling(texture,{...options,maxAnisotropy:maximum});
      assert.equal(texture.anisotropy,Math.max(1,Math.min(4,maximum)));
      assert.equal(texture.minFilter,THREE.LinearMipmapLinearFilter);
    }
    texture.dispose();
  }
});

test('actual scene resize preserves camera/model projection and avoids buffer churn from unchanged viewport events',async t=>{
  const keys=['matchMedia','devicePixelRatio','visualViewport'];
  const saved=new Map(keys.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  t.after(()=>{for(const [key,value] of saved)if(value)Object.defineProperty(globalThis,key,value);else delete globalThis[key];});
  globalThis.matchMedia=()=>({matches:false});globalThis.devicePixelRatio=3;
  const {TableScene}=await import('../src/table-scene.js');
  for(const [width,height,compact] of [[390,844,false],[844,390,true]]) {
    const calls=[],table=new THREE.Group(),trump=new THREE.Group();
    const scene={host:{getBoundingClientRect:()=>({width,height}),closest:()=>({dataset:{layoutMode:compact?'strip':'ring'}})},
      mode:'game',low:false,phoneQuality:true,maxDrawingBufferDimension:8192,
      renderer:{setDrawingBufferSize(...args){calls.push(args);}},camera:new THREE.PerspectiveCamera(43,1,.1,80),
      tableSurface:[table],tableInlay:new THREE.Group(),trump,layoutDecorations(){},
      updateAssetLighting(){},alignCardSeats(){},alignTrump(){},requestDraw(){}};
    globalThis.devicePixelRatio=3;TableScene.prototype.resize.call(scene);
    const projection=scene.camera.projectionMatrix.toArray(),world=scene.camera.matrixWorld.toArray();
    for(let i=0;i<120;i++) {
      // Browser bars/keyboard/pinch do not introduce a second density multiplier.
      globalThis.visualViewport={width:200+i,height:100+i,scale:1+i/20};
      TableScene.prototype.resize.call(scene);
    }
    assert.equal(calls.length,1);assert.deepEqual(calls[0],[width,height,3]);
    assert.deepEqual(scene.camera.projectionMatrix.toArray(),projection);
    assert.deepEqual(scene.camera.matrixWorld.toArray(),world);assert.deepEqual(table.scale.toArray(),[1,1,1]);
    globalThis.devicePixelRatio=2;TableScene.prototype.resize.call(scene);
    assert.equal(calls.length,2);assert.deepEqual(calls[1],[width,height,2]);
    assert.deepEqual(scene.camera.projectionMatrix.toArray(),projection);
    assert.equal(scene.low,false);assert.equal(scene.phoneQuality,true);
  }
});


test('restored contexts refresh hardware limits and cached sampling without choosing another quality mode',async t=>{
  const saved=globalThis.matchMedia;globalThis.matchMedia=()=>({matches:false});
  t.after(()=>{if(saved)globalThis.matchMedia=saved;else delete globalThis.matchMedia;});
  const {TableScene}=await import('../src/table-scene.js');
  let dimension=8192,anisotropy=16;
  const texture=new THREE.Texture();
  const scene={phoneQuality:true,low:false,textures:new Map([['card',texture]]),
    renderer:{getContext:()=>({MAX_RENDERBUFFER_SIZE:0x84e8,getParameter:()=>dimension}),
      capabilities:{maxTextureSize:8192,getMaxAnisotropy:()=>anisotropy}}};
  TableScene.prototype.refreshRenderCapabilities.call(scene);
  assert.equal(texture.anisotropy,8);assert.equal(scene.maxDrawingBufferDimension,8192);
  const version=texture.version;
  TableScene.prototype.refreshRenderCapabilities.call(scene);assert.equal(texture.version,version);
  dimension=2048;anisotropy=2;
  TableScene.prototype.refreshRenderCapabilities.call(scene);
  assert.equal(texture.anisotropy,2);assert.equal(scene.maximumAnisotropy,2);
  assert.equal(scene.maxDrawingBufferDimension,2048);assert.equal(texture.version,version+1);
  assert.equal(scene.low,false);assert.equal(scene.phoneQuality,true);texture.dispose();
});
