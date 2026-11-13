import test from 'node:test';
import assert from 'node:assert/strict';
import { readLowGraphics, saveLowGraphics, SlowFrameAdviser, QualityHintOnce, QUALITY_HINT_SEEN_KEY } from '../src/graphics-quality.js';
import { GraphicsQualityHint, qualityHintPosition } from '../src/graphics-quality-hint.js';
import { FrameScheduler } from '../src/frame-scheduler.js';
const storage = () => { const data = new Map(); return { data, getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) }; };
const blocked = { getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); } };

test('fresh phone/desktop defaults high, only explicit true stays low, persistence failure is harmless', () => {
  for (const raw of [null, 'false', '', 'automatic', 'true']) {
    const store = storage(); if (raw !== null) store.setItem('wizard-low-graphics', raw);
    assert.equal(readLowGraphics(store), raw === 'true');
    assert.equal(store.data.size, raw === null ? 0 : 1, 'reading never creates an automatic choice');
    saveLowGraphics(true, store); assert.equal(readLowGraphics(store), true);
    saveLowGraphics(false, store); assert.equal(readLowGraphics(store), false);
  }
  assert.equal(readLowGraphics(blocked), false); assert.doesNotThrow(() => saveLowGraphics(true, blocked));
});
function stream(adviser, { time = 6000, delta = 100, delay = 33, count = 60, eligible = true } = {}) {
  let advised = 0;
  for (let i = 0; i < count; i++, time += delta) if (adviser.sample(time, delay, eligible)) advised++;
  return { time, advised };
}
test('sustained genuinely missed cadence advises without changing settings', () => {
  const adviser = new SlowFrameAdviser();
  assert.equal(stream(adviser, { count: 50 }).advised, 0, 'two complete windows required');
  assert.equal(adviser.sample(11000, 33, true), true);
  assert.equal(readLowGraphics(storage()), false);
});
test('intentional 20/30 Hz and normal 30/60 Hz card motion never trigger', () => {
  for (const [delta, delay] of [[50,50],[50,33],[33.4,33],[33.4,0],[16.7,0]]) {
    assert.equal(stream(new SlowFrameAdviser(), { delta, delay, count: 1800 }).advised, 0);
  }
});
test('initial load, idle work, lost focus, hidden/paused/low/fallback and long gaps are not samples', () => {
  assert.equal(stream(new SlowFrameAdviser(), { time: 0, count: 50 }).advised, 0);
  for (const options of [{eligible:false},{delay:null},{delay:4000},{delta:1001}]) {
    assert.equal(stream(new SlowFrameAdviser(), { ...options, count: 200 }).advised, 0);
  }
  const adviser = new SlowFrameAdviser(); stream(adviser,{count:30});
  adviser.reset(9000,2000);
  assert.equal(stream(adviser,{time:9000,count:45}).advised,0,'resize/focus drops old bad windows and gives grace');
});
test('a healthy window breaks intermittent stalls; one hitch cannot trip it', () => {
  const adviser = new SlowFrameAdviser();
  let run = stream(adviser,{count:27});
  run = stream(adviser,{time:run.time,delta:33.4,count:160}); assert.equal(run.advised,0);
  assert.equal(stream(adviser,{time:run.time,count:27}).advised,0);
});
test('actual shared FrameScheduler replay accounts for its deliberate timers and detects sustained late frames', () => {
  for (const step of [1000/60,1000/30,1000/20,100]) {
    let now=0, frame, timer, detections=0, draws=0;
    const adviser = new SlowFrameAdviser();
    const scheduler = new FrameScheduler({now:()=>now,requestFrame:cb=>{frame=cb;return 1;},cancelFrame:()=>{frame=null;},
      setTimer:(cb,delay)=>{timer={cb,at:now+delay};return 1;},clearTimer:()=>{timer=null;}});
    const client=scheduler.add(time=>{
      draws++;
      // Ambient 33ms switches to unthrottled card motion and back, like TableScene.
      const delay=now%2000<400?0:33;
      if(adviser.sample(time,delay,true))detections++;
      return delay;
    });
    client.request();
    for(let i=0;i<Math.ceil(18000/step);i++) {
      now+=step;
      if(timer&&timer.at<=now){const t=timer;timer=null;t.cb();}
      if(frame){const cb=frame;frame=null;cb(now);}
    }
    assert.ok(draws>0); assert.equal(detections>0,step===100);
    client.cancel(); assert.equal(frame,null); assert.equal(timer,null);
  }
});
test('shown flag survives new controllers, refresh and reconnect; blocked storage falls back to current page once', () => {
  const store=storage(), first=new QualityHintOnce(store);
  assert.equal(first.available(),true); assert.equal(store.getItem(QUALITY_HINT_SEEN_KEY),null);
  first.shown(); assert.equal(first.available(),false); assert.equal(new QualityHintOnce(store).available(),false);
  const fallback=new QualityHintOnce(blocked); assert.equal(fallback.available(),true); fallback.shown(); assert.equal(fallback.available(),false);
});
test('position avoids cards/controls and defers when no safe visible slot exists', () => {
  const viewport={right:390,bottom:844};
  const obstacles=[{left:0,right:390,top:0,bottom:130},{left:0,right:390,top:500,bottom:844}];
  const pos=qualityHintPosition(280,76,viewport,obstacles); assert.ok(pos);
  assert.ok(pos.y>=140&&pos.y+76<=490);
  assert.equal(qualityHintPosition(280,76,viewport,[{left:0,right:390,top:0,bottom:844}]),null);
  assert.equal(qualityHintPosition(400,76,viewport,[]),null);
});
function fakeDOM() {
  const nodes=[];
  const doc={documentElement:{clientWidth:390,clientHeight:844},body:{append:node=>nodes.push(node)},querySelectorAll:()=>[],
    createElement:()=>{const buttons=new Map();return {style:{},setAttribute(){},getBoundingClientRect:()=>({width:280,height:76}),
      querySelector:key=>{if(!buttons.has(key))buttons.set(key,{});return buttons.get(key);},remove(){this.removed=true;}};}};
  return {doc,nodes};
}
test('real hint controller: explicit lower only, keep/close/timeout ignore, repeated clicks, no space and navigation', () => {
  for(const action of ['lower','keep','close','timeout','navigation']) {
    const {doc}=fakeDOM(), store=storage();let lower=0,timer,allowed=true;
    const hint=new GraphicsQualityHint({document:doc,once:new QualityHintOnce(store),canShow:()=>allowed,lower:()=>lower++,setTimer:cb=>{timer=cb;return 1;},clearTimer(){}});
    assert.equal(hint.suggest(0),true); const node=hint.node;
    assert.equal(store.getItem(QUALITY_HINT_SEEN_KEY),'true'); assert.equal(lower,0);
    if(action==='timeout')timer();else if(action==='navigation'){allowed=false;hint.refresh();}
    else { const button=node.querySelector(`[data-quality-${action}]`);button.onclick();button.onclick(); }
    assert.equal(lower,action==='lower'?1:0);assert.equal(hint.node,null);
    assert.equal(hint.suggest(20000),false);assert.equal(new QualityHintOnce(store).available(),false);
  }
  const {doc}=fakeDOM(),store=storage();doc.documentElement.clientHeight=60;
  const hint=new GraphicsQualityHint({document:doc,once:new QualityHintOnce(store),canShow:()=>true});
  assert.equal(hint.suggest(0),false);assert.equal(store.getItem(QUALITY_HINT_SEEN_KEY),null);
});

test('TableScene setter is the only quality transition, persists across scenes and tolerates denied storage', async t => {
  const originalMedia=globalThis.matchMedia,originalStorage=globalThis.localStorage;
  globalThis.matchMedia=()=>({matches:false});globalThis.localStorage=storage();
  t.after(()=>{if(originalMedia)globalThis.matchMedia=originalMedia;else delete globalThis.matchMedia;
    if(originalStorage)globalThis.localStorage=originalStorage;else delete globalThis.localStorage;});
  const {TableScene}=await import('../src/table-scene.js');
  let layouts=0,lighting=0;const material={};
  const scene={low:readLowGraphics(),renderer:{shadowMap:{enabled:false}},scene:{traverse:cb=>cb({material})},
    resize(){layouts++;},updateAssetLighting(){lighting++;},qualityAdviser:new SlowFrameAdviser()};
  assert.equal(scene.low,false);
  for(const low of [true,false,true]) {
    TableScene.prototype.setLow.call(scene,low);assert.equal(scene.low,low);assert.equal(readLowGraphics(),low);
    assert.equal(scene.renderer.shadowMap.enabled,false);assert.equal(material.needsUpdate,true);
  }
  assert.equal(layouts,3);assert.equal(lighting,3);
  globalThis.localStorage=blocked;
  assert.doesNotThrow(()=>TableScene.prototype.setLow.call(scene,false));assert.equal(scene.low,false);
});

test('actual TableScene animate return values preserve ambient, card-motion and paused/reduced demand', async t => {
  const originalMedia=globalThis.matchMedia,originalDoc=globalThis.document;
  const media={matches:false};globalThis.matchMedia=()=>media;globalThis.document={hidden:false};
  t.after(()=>{if(originalMedia)globalThis.matchMedia=originalMedia;else delete globalThis.matchMedia;
    if(originalDoc)globalThis.document=originalDoc;else delete globalThis.document;});
  const {TableScene}=await import('../src/table-scene.js?quality-cadence');
  const {TableMotion}=await import('../src/table-motion.js');
  let now=0;const motion=new TableMotion(()=>now);
  const state={phase:'play',round:1,completedTricks:0,trick:[],events:[]};
  motion.sync(state,{serverNow:0});
  let renders=0;const scene={host:{isConnected:true},mode:'game',motion,assetLighting:{},low:false,paused:false,
    dust:{rotation:{}},orb:{rotation:{}},trump:{visible:false},cards:new Map(),drawCards(){},updateAssetLighting(){},
    renderer:{render(){renders++;}}};
  assert.equal(TableScene.prototype.animate.call(scene,now),33);
  state.trick.push({card:{id:'red-1'},player:0});
  state.events.push({type:'play',round:1,card:{id:'red-1'},time:0});motion.sync(state,{serverNow:0});
  now=50;assert.equal(TableScene.prototype.animate.call(scene,now),0);
  scene.low=true;assert.equal(TableScene.prototype.animate.call(scene,now),33);
  now=2000;assert.equal(TableScene.prototype.animate.call(scene,now),50);
  scene.paused=true;assert.equal(TableScene.prototype.animate.call(scene,now),null);
  scene.paused=false;media.matches=true;assert.equal(TableScene.prototype.animate.call(scene,now),null);
  globalThis.document.hidden=true;const before=renders;assert.equal(TableScene.prototype.animate.call(scene,now),null);assert.equal(renders,before);
});
