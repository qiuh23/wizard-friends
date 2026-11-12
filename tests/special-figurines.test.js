import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { SpecialFigurines, SPECIAL_FIGURINE_SCALE, figurineShade } from '../src/rendering/special-figurines.mjs';
import { specialCardPose } from '../src/special-card-motion.js';
import { TableMotion } from '../src/table-motion.js';

function setup() {
  let now = 1000;
  const motion = new TableMotion(() => now);
  const state = { phase:'play', round:2, completedTricks:0, trick:[], events:[] };
  motion.sync(state, {initial:true, serverNow:now});
  const sync = (options = {}) => motion.sync(state, {serverNow:now, ...options});
  const play = (id, kind = 'wizard') => {
    const card = {id, kind}; state.trick.push({card, player:state.trick.length});
    state.events.push({type:'play', round:state.round, card, time:now}); sync();
  };
  return {motion,state,sync,play,advance:ms => {now += ms;}};
}

test('special characters use one real mesh, shared geometry and no textures or lights', () => {
  const library = new SpecialFigurines();
  for (const kind of ['wizard','jester']) {
    const a=library.create(kind), b=library.create(kind);
    assert.equal(a.geometry, b.geometry); assert.notEqual(a.material, b.material);
    assert.equal(a.isMesh, true); assert.equal(a.children.length, 0);
    assert.ok(a.geometry.attributes.position.count / 3 <= 1200);
    assert.equal(a.geometry.attributes.position.count, a.geometry.attributes.color.count);
    assert.ok(a.geometry.boundingBox.min.y >= 0);
    assert.ok(a.geometry.boundingBox.max.y < 1.2);
    assert.equal(a.material.map, null); assert.equal(a.castShadow, false);
    assert.equal(a.material.fog, false);
    assert.equal(a.material.isMeshBasicMaterial, true);
    assert.equal(a.material.toneMapped, false);
    assert.equal(a.material.depthTest, true);
    library.release(a); library.release(b);
  }
  assert.equal(library.create('number'), null); library.dispose();
});

test('instance removal never disposes geometry another card still uses; owner disposal is idempotent', () => {
  const library=new SpecialFigurines(), a=library.create('wizard'), b=library.create('wizard');
  let geometries=0, materials=0;
  a.geometry.addEventListener('dispose', () => geometries++);
  a.material.addEventListener('dispose', () => materials++);
  library.release(a); assert.equal(geometries,0); assert.equal(materials,1);
  assert.equal(b.geometry.attributes.position.count > 0,true);
  library.release(b); library.dispose(); library.dispose(); assert.equal(geometries,1);
  assert.equal(library.create('wizard'),null);
});

test('new special play emerges after landing and settles back on its own card face', () => {
  const s=setup(); s.play('w1');
  assert.equal(s.motion.specialPose('w1').visible,false);
  s.advance(630); const jump=s.motion.specialPose('w1');
  assert.ok(jump.y > .5); assert.ok(jump.z > 0 && jump.z < .10);
  assert.equal(s.motion.isAnimating(),true);
  s.advance(490); const landed=s.motion.specialPose('w1');
  assert.equal(landed.y,0); assert.equal(landed.z,.10); assert.equal(landed.scale,1);
  assert.equal(s.motion.isAnimating(),false);
  s.play('n1','number'); assert.equal(s.motion.specialPose('n1'),null);
});

test('chat, sorting, resize, pause and a second special card do not restart the first jump', () => {
  const s=setup(); s.play('j1','jester'); s.advance(500);
  const pose=s.motion.specialPose('j1'); s.sync(); assert.deepEqual(s.motion.specialPose('j1'),pose);
  s.motion.setEmphasisScale(1.015); assert.deepEqual(s.motion.specialPose('j1'),pose);
  s.play('w1'); assert.deepEqual(s.motion.specialPose('j1'),pose);
  s.state.lifecycle={paused:true}; s.sync(); s.advance(15000); s.sync();
  assert.deepEqual(s.motion.specialPose('j1'),pose);
  s.state.lifecycle.paused=false; s.sync(); s.advance(620);
  assert.equal(s.motion.specialPose('j1').active,false);
  assert.ok(s.motion.specialPose('w1').active);
});

test('initial load, reconnect, stale events and missing events show a settled figure without replay', () => {
  for (const scenario of ['initial','late','missing']) {
    const s=setup(); s.play('w1'); s.advance(scenario==='late'?3000:500);
    const replacement=new TableMotion(() => 5000);
    if(scenario==='missing')s.state.events=[];
    replacement.sync(s.state,{initial:scenario==='initial',serverNow:scenario==='late'?5000:1500});
    assert.equal(replacement.specialPose('w1').active,false,scenario);
    assert.equal(replacement.specialPose('w1').y,0,scenario);
    assert.equal(replacement.specialPose('w1').z,.10,scenario);
  }
});

test('late but still current events continue the shared jump age rather than replay from zero', () => {
  const s=setup(); s.state.trick=[{player:0,card:{id:'w1',kind:'wizard'}}];
  s.state.events=[{type:'play',round:2,card:{id:'w1'},time:1000}]; s.advance(630); s.sync();
  assert.deepEqual(s.motion.specialPose('w1'),specialCardPose('wizard',630));
});

test('reduced motion settles immediately; duplicate snapshots cannot turn it into a new jump', () => {
  const s=setup(); s.play('w1'); s.advance(400); s.sync({reducedMotion:true});
  assert.equal(s.motion.specialPose('w1').y,0); assert.equal(s.motion.specialPose('w1').active,false);
  s.sync({reducedMotion:false}); assert.equal(s.motion.specialPose('w1').active,false);
});

test('collection retracts figures before cards reach the winner and a new trick clears them', () => {
  const s=setup(); s.play('w1'); s.advance(1200);
  s.state.phase='trickEnd'; s.state.completedTricks=1;
  s.state.lifecycle={nextTrickAt:5200}; s.sync(); s.advance(2400);
  assert.equal(s.motion.specialPose('w1').visible,false);
  s.state.phase='play';s.state.trick=[];s.sync();
  assert.equal(s.motion.specialEntries.size,0);assert.equal(s.motion.specialPose('w1'),null);
});

test('HTML and WebGL share one immutable special-character sample per display frame', () => {
  const s=setup();s.play('j1','jester');s.advance(600);
  const sample=s.motion.snapshot(7);s.advance(10);
  assert.equal(s.motion.snapshot(7),sample);
  assert.deepEqual(sample.specialPoses.get('j1'),specialCardPose('jester',600));
  assert.notEqual(s.motion.snapshot(8),sample);
});


test('system reduced-motion toggle retires a paused entrance without needing a new state snapshot', () => {
  const s=setup();s.play('w1');s.advance(500);s.state.lifecycle={paused:true};s.sync();
  s.motion.setReducedMotion(true);const settled=s.motion.specialPose('w1');
  s.motion.setReducedMotion(false);assert.deepEqual(s.motion.specialPose('w1'),settled);
});


test('brighter local shading has a bounded fill floor and larger figures still fit the card footprint', () => {
  assert.ok(SPECIAL_FIGURINE_SCALE/.55>1.4);
  for(const n of [[0,1,0],[0,-1,0],[0,0,1],[0,0,-1],[1,0,0],[-1,0,0]]){
    assert.ok(figurineShade(...n)>=.64 && figurineShade(...n)<=1);
  }
  const library=new SpecialFigurines();
  for(const kind of ['wizard','jester']){
    const figure=library.create(kind),box=figure.geometry.boundingBox;
    assert.ok(Math.abs(box.min.x)*SPECIAL_FIGURINE_SCALE<.55);
    assert.ok(box.max.x*SPECIAL_FIGURINE_SCALE<.55);
    assert.ok(box.min.z*SPECIAL_FIGURINE_SCALE+.10>-.83);
    assert.ok(box.max.z*SPECIAL_FIGURINE_SCALE+.10<.83);
    library.release(figure);
  }
  library.dispose();
});


test('wizard eyes remain visible below the brim at the game camera angle', () => {
  const library=new SpecialFigurines(),figure=library.create('wizard');figure.updateMatrixWorld(true);
  const camera=new THREE.Vector3(0,8.48,5.3),colors=figure.geometry.attributes.color;
  for(const x of [-.05,.05]){
    const target=new THREE.Vector3(x,.695,.185);
    const hit=new THREE.Raycaster(camera,target.sub(camera).normalize()).intersectObject(figure)[0];
    assert.ok(hit);
    assert.ok(Math.max(colors.getX(hit.face.a),colors.getY(hit.face.a),colors.getZ(hit.face.a))<.08,
      'the ray reaches the dark eye rather than blue hat or pale face');
  }
  library.release(figure);library.dispose();
});
