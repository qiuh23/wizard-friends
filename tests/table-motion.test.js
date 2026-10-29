import test from 'node:test';
import assert from 'node:assert/strict';
import { TableMotion, CARD_COLLECT_MS, LEADING_CARD_SCALE } from '../src/table-motion.js';

function setup() {
  let now = 1000;
  const motion = new TableMotion(() => now);
  const state = { phase: 'play', round: 2, completedTricks: 0, trick: [], events: [] };
  motion.sync(state, { initial: true, serverNow: now });
  const sync = () => motion.sync(state, { serverNow: now });
  const play = id => {
    state.trick.push({ card: { id }, player: state.trick.length });
    state.events.push({ type: 'play', round: state.round, card: { id }, time: now });
    sync();
  };
  return { motion, state, sync, play, advance: ms => { now += ms; } };
}

test('repeated redraws and social snapshots preserve card arrival progress', () => {
  const s = setup(); s.play('red-1'); s.advance(140);
  const before = s.motion.pose('red-1');
  s.sync(); assert.deepEqual(s.motion.pose('red-1'), before);
  s.play('blue-2'); assert.deepEqual(s.motion.pose('red-1'), before);
  assert.equal(s.motion.pose('blue-2').enter, 0);
  s.advance(280); assert.equal(s.motion.pose('red-1').enter, 1);
});

test('arrival freezes through a long pause and resumes without jumping or replaying', () => {
  const s = setup(); s.play('red-1'); s.advance(100);
  s.state.lifecycle = { paused: true }; s.sync();
  const before = s.motion.pose('red-1'); s.advance(10000); s.sync();
  assert.deepEqual(s.motion.pose('red-1'), before);
  s.state.lifecycle.paused = false; s.sync(); s.advance(320);
  assert.equal(s.motion.pose('red-1').enter, 1);
});

test('collection follows the authority deadline, including delayed frames, pause and recovery', () => {
  const s = setup(); s.play('red-1');
  s.state.phase = 'trickEnd'; s.state.completedTricks = 1;
  s.state.lifecycle = { nextTrickAt: 6000 }; s.sync();
  s.advance(5000 - CARD_COLLECT_MS); assert.equal(s.motion.pose('red-1').collect, 0);
  s.advance(CARD_COLLECT_MS / 2); const half = s.motion.pose('red-1'); assert.equal(half.collect, .5);
  s.sync(); assert.deepEqual(s.motion.pose('red-1'), half);
  s.state.lifecycle = { paused: true, nextTrickAt: null, reviewRemainingMs: CARD_COLLECT_MS / 2 }; s.sync();
  s.advance(10000); s.sync(); assert.deepEqual(s.motion.pose('red-1'), half);
  s.state.lifecycle = { paused: false, nextTrickAt: 16000 }; s.sync();
  s.advance(CARD_COLLECT_MS / 2); assert.equal(s.motion.pose('red-1').collect, 1);
  const recovered = new TableMotion(() => 16000 - CARD_COLLECT_MS / 2);
  recovered.sync(s.state, { initial: true, serverNow: 16000 - CARD_COLLECT_MS / 2 });
  assert.equal(recovered.pose('red-1').enter, 1);
  assert.equal(recovered.pose('red-1').collect, .5);
});

test('six cards sweep in order and remain readable until near the winner, all before the same deadline', () => {
  const s = setup();
  for (let i = 0; i < 6; i++) s.play(`card-${i}`);
  s.state.phase = 'trickEnd'; s.state.completedTricks = 1;
  s.state.lifecycle = { nextTrickAt: 6000 }; s.sync();
  s.advance(5000 - CARD_COLLECT_MS + 300);
  const first = s.motion.pose('card-0'), last = s.motion.pose('card-5');
  assert.ok(first.collect > last.collect && last.collect > 0);
  assert.equal(first.opacity, 1); assert.ok(first.lift > 0);
  s.advance(CARD_COLLECT_MS - 300);
  for (let i = 0; i < 6; i++) {
    const pose = s.motion.pose(`card-${i}`);
    assert.equal(pose.collect, 1); assert.equal(pose.opacity, 0); assert.equal(pose.lift, 0);
  }
  assert.equal(s.motion.isAnimating(), false);
});

test('leader emphasis transfers smoothly, survives redraw, and freezes with the table clock', () => {
  const s = setup(); s.play('red-1'); s.play('blue-2');
  const sync = leader => s.motion.sync(s.state, { serverNow: 1000, leader });
  sync('red-1'); s.advance(180);
  assert.equal(s.motion.pose('red-1').scale, LEADING_CARD_SCALE);
  sync('blue-2'); s.advance(90);
  const before = s.motion.pose('blue-2');
  assert.ok(before.scale > 1 && before.scale < LEADING_CARD_SCALE);
  sync('blue-2'); assert.deepEqual(s.motion.pose('blue-2'), before);
  s.state.lifecycle = { paused:true }; sync('blue-2'); s.advance(10000);
  assert.deepEqual(s.motion.pose('blue-2'), before);
  s.state.lifecycle.paused = false; sync('blue-2'); s.advance(90);
  assert.equal(s.motion.pose('red-1').scale, 1);
  assert.equal(s.motion.pose('blue-2').scale, LEADING_CARD_SCALE);
});

test('practice keeps a manual review visible and a new trick discards old motion', () => {
  const s = setup(); s.play('red-1');
  s.state.phase = 'trickEnd'; s.state.completedTricks = 1; s.sync();
  s.advance(10000); assert.equal(s.motion.pose('red-1').collect, 0);
  s.state.phase = 'play'; s.state.trick = []; s.sync();
  assert.equal(s.motion.entries.size, 0);
  s.state.round = 3; s.state.completedTricks = 0; s.play('red-1');
  assert.equal(s.motion.pose('red-1').enter, 0);
});
