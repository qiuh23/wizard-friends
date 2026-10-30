import test from 'node:test';
import assert from 'node:assert/strict';
import { ScoreBubbles, SCORE_BUBBLE_MS } from '../src/score-bubbles.js';

function setup() {
  let now=10000;
  const bubbles=new ScoreBubbles(()=>now);
  const state={phase:'play',round:1,eventSeq:8,events:[]};
  const sync=(options={})=>bubbles.sync(state,{scope:'room-a',serverNow:now,...options});
  sync({initial:true});
  Object.assign(state,{phase:'roundEnd',eventSeq:11,events:[{seq:10,type:'roundEnd',round:1,time:now,
    result:[{id:'a',delta:20},{id:'b',delta:-10}]}]});
  return {bubbles,state,sync,advance:ms=>now+=ms};
}

test('fresh settlement uses public score deltas once and expires on the presentation clock', () => {
  const s=setup(), before=JSON.stringify(s.state); s.sync();
  assert.deepEqual([...s.bubbles.effect.results],[['a',20],['b',-10]]);
  s.advance(800); s.sync(); assert.equal(s.bubbles.draw(),SCORE_BUBBLE_MS-800);
  s.advance(1000); assert.equal(s.bubbles.draw(),null); s.sync();
  assert.equal(s.bubbles.effect,null); assert.equal(JSON.stringify(s.state),before);
});

test('final round animates; late events get only their remaining lifetime', () => {
  const s=setup(); s.state.phase='finished'; s.advance(600); s.sync();
  assert.equal(s.bubbles.draw(),1200);
  s.advance(1200); assert.equal(s.bubbles.draw(),null);
  const old=setup(); old.advance(SCORE_BUBBLE_MS); old.sync(); assert.equal(old.bubbles.effect,null);
});

test('initial snapshots, reconnects, room switches and unfinished rounds do not replay', () => {
  for(const options of [{initial:true},{scope:'room-b'}]) {
    const s=setup(); s.sync(options); s.sync(options); assert.equal(s.bubbles.effect,null);
  }
  const s=setup(); s.state.phase='play'; s.sync(); assert.equal(s.bubbles.effect,null);
});

test('leaving settlement and pausing clear bubbles without restarting on resume', () => {
  for(const next of [{phase:'bid'},{phase:'lobby'},{lifecycle:{paused:true}}]) {
    const s=setup(); s.sync(); assert.notEqual(s.bubbles.effect,null);
    Object.assign(s.state,next); s.sync(); assert.equal(s.bubbles.effect,null);
    s.state.lifecycle={}; s.state.phase='roundEnd'; s.sync(); assert.equal(s.bubbles.effect,null);
  }
});
