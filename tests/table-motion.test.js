import test from 'node:test';
import assert from 'node:assert/strict';
import { TableMotion, CARD_COLLECT_MS, CARD_LABEL_FADE_MS, LEADING_CARD_SCALE, COMPACT_LEADING_CARD_SCALE } from '../src/table-motion.js';
import { TRICK_REVIEW_MS } from '../src/game.js';

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
  s.state.lifecycle = { nextTrickAt: 1000 + TRICK_REVIEW_MS }; s.sync();
  s.advance(TRICK_REVIEW_MS - CARD_COLLECT_MS); assert.equal(s.motion.pose('red-1').collect, 0);
  s.advance(CARD_COLLECT_MS / 2); const half = s.motion.pose('red-1'); assert.equal(half.collect, .5);
  s.sync(); assert.deepEqual(s.motion.pose('red-1'), half);
  s.state.lifecycle = { paused: true, nextTrickAt: null, reviewRemainingMs: CARD_COLLECT_MS / 2 }; s.sync();
  s.advance(10000); s.sync(); assert.deepEqual(s.motion.pose('red-1'), half);
  const resumedDeadline = 11000 + TRICK_REVIEW_MS;
  s.state.lifecycle = { paused: false, nextTrickAt: resumedDeadline }; s.sync();
  s.advance(CARD_COLLECT_MS / 2); assert.equal(s.motion.pose('red-1').collect, 1);
  const recovered = new TableMotion(() => resumedDeadline - CARD_COLLECT_MS / 2);
  recovered.sync(s.state, { initial: true, serverNow: resumedDeadline - CARD_COLLECT_MS / 2 });
  assert.equal(recovered.pose('red-1').enter, 1);
  assert.equal(recovered.pose('red-1').collect, .5);
});

test('six cards sweep in order and remain readable until near the winner, all before the same deadline', () => {
  const s = setup();
  for (let i = 0; i < 6; i++) s.play(`card-${i}`);
  s.state.phase = 'trickEnd'; s.state.completedTricks = 1;
  s.state.lifecycle = { nextTrickAt: 1000 + TRICK_REVIEW_MS }; s.sync();
  s.advance(TRICK_REVIEW_MS - CARD_COLLECT_MS + 300);
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

test('names fade before any card collects, and freeze and recover on the shared review clock', () => {
  const s = setup(); s.play('red-1'); s.play('blue-2');
  s.state.phase = 'trickEnd'; s.state.completedTricks = 1;
  s.state.lifecycle = { nextTrickAt:1000 + TRICK_REVIEW_MS }; s.sync();
  s.advance(TRICK_REVIEW_MS - CARD_COLLECT_MS - CARD_LABEL_FADE_MS / 2);
  assert.equal(s.motion.labelOpacity(), .5);
  assert.equal(s.motion.pose('red-1').collect, 0);
  s.state.lifecycle = { paused:true, reviewRemainingMs:CARD_COLLECT_MS + CARD_LABEL_FADE_MS / 2 }; s.sync();
  s.advance(10000); s.sync(); assert.equal(s.motion.labelOpacity(), .5);
  s.state.lifecycle = { nextTrickAt:11000 + TRICK_REVIEW_MS }; s.sync();
  s.advance(CARD_LABEL_FADE_MS / 2);
  assert.equal(s.motion.labelOpacity(), 0);
  assert.equal(s.motion.pose('red-1').collect, 0);
  s.advance(200);
  assert.ok(s.motion.pose('red-1').collect > 0);
  assert.ok(s.motion.pose('blue-2').collect > 0);
  s.sync(); assert.equal(s.motion.labelOpacity(), 0);
  const recovered = new TableMotion(() => 1000);
  recovered.sync(s.state, {initial:true, serverNow:11000 + TRICK_REVIEW_MS - CARD_COLLECT_MS + 200});
  assert.equal(recovered.labelOpacity(), 0);
  s.motion.sync(s.state, {reducedMotion:true}); assert.equal(s.motion.labelOpacity(), 1);
});

test('leader emphasis transfers smoothly, survives redraw, and freezes with the table clock', () => {
  const s = setup(); s.play('red-1'); s.play('blue-2');
  const sync = leader => s.motion.sync(s.state, { serverNow: 1000, leader });
  sync('red-1'); s.advance(220);
  assert.equal(s.motion.pose('red-1').scale, LEADING_CARD_SCALE);
  sync('blue-2'); s.advance(110);
  const before = s.motion.pose('blue-2');
  assert.ok(before.scale > 1 && before.scale < LEADING_CARD_SCALE);
  sync('blue-2'); assert.deepEqual(s.motion.pose('blue-2'), before);
  s.state.lifecycle = { paused:true }; sync('blue-2'); s.advance(10000);
  assert.deepEqual(s.motion.pose('blue-2'), before);
  s.state.lifecycle.paused = false; sync('blue-2'); s.advance(110);
  assert.equal(s.motion.pose('red-1').scale, 1);
  assert.equal(s.motion.pose('blue-2').scale, LEADING_CARD_SCALE);
});

test('viewport emphasis changes keep arrival timing and transfer from the interrupted scale', () => {
  const s = setup(); s.play('wizard-1'); s.play('wizard-2');
  s.motion.sync(s.state, { leader:'wizard-1', serverNow:1000 });
  s.advance(110);
  const first = s.motion.pose('wizard-1'), timing = s.motion.timing('wizard-1');
  s.motion.setEmphasisScale(COMPACT_LEADING_CARD_SCALE);
  assert.deepEqual(s.motion.timing('wizard-1'), timing);
  assert.equal(s.motion.pose('wizard-1').scale, first.scale);
  s.advance(220);
  assert.equal(s.motion.pose('wizard-1').scale, COMPACT_LEADING_CARD_SCALE);
  assert.equal(s.motion.pose('wizard-1').lift, 4);
  assert.equal(s.motion.pose('wizard-2').scale, 1);
  s.motion.sync(s.state, { leader:'wizard-2', serverNow:1330 });
  s.advance(70);
  const interrupted = s.motion.pose('wizard-2').scale;
  s.motion.sync(s.state, { leader:'wizard-1', serverNow:1400 });
  assert.equal(s.motion.pose('wizard-2').scale, interrupted);
  s.advance(220);
  assert.equal(s.motion.pose('wizard-1').scale, COMPACT_LEADING_CARD_SCALE);
  assert.equal(s.motion.pose('wizard-2').scale, 1);
});

test('recovery and reduced motion show the final maximum immediately without replaying arrivals', () => {
  const state = { phase:'play', round:2, completedTricks:0, trick:[
    {card:{id:'jester-1'},player:0}, {card:{id:'jester-2'},player:1}], events:[] };
  let now = 1000;
  const motion = new TableMotion(() => now);
  motion.sync(state, { initial:true, leader:'jester-1', serverNow:now });
  assert.equal(motion.pose('jester-1').enter, 1);
  assert.equal(motion.pose('jester-1').scale, LEADING_CARD_SCALE);
  motion.sync(state, { leader:'jester-2', reducedMotion:true, serverNow:now });
  assert.deepEqual(motion.pose('jester-2'), {enter:1,collect:0,lift:0,opacity:1,scale:LEADING_CARD_SCALE});
  assert.equal(motion.pose('jester-1').scale, 1);
  assert.equal(motion.isAnimating(), false);
  now += 10000;
  motion.sync(state, { leader:'jester-2', reducedMotion:false, serverNow:now });
  assert.equal(motion.pose('jester-2').scale, LEADING_CARD_SCALE);
  assert.equal(motion.pose('jester-2').enter, 1);
});

test('manual practice review collects once and the next trick discards old motion', () => {
  const s = setup(); s.play('red-1');
  s.state.phase = 'trickEnd'; s.state.completedTricks = 1;
  s.state.events.push({type:'trickEnd',round:2,completedTricks:1,time:1000}); s.sync();
  s.advance(TRICK_REVIEW_MS - CARD_COLLECT_MS); assert.equal(s.motion.pose('red-1').collect, 0);
  s.advance(CARD_COLLECT_MS / 2); assert.equal(s.motion.pose('red-1').collect, .5);
  s.sync(); assert.equal(s.motion.pose('red-1').collect, .5);
  s.advance(CARD_COLLECT_MS / 2); assert.equal(s.motion.pose('red-1').collect, 1);
  assert.equal(s.state.phase, 'trickEnd'); assert.equal(s.state.trick.length, 1);
  s.advance(10000); s.sync(); assert.equal(s.motion.pose('red-1').collect, 1);
  s.state.phase = 'play'; s.state.trick = []; s.sync();
  assert.equal(s.motion.entries.size, 0);
  s.state.round = 3; s.state.completedTricks = 0; s.play('red-1');
  assert.equal(s.motion.pose('red-1').enter, 0);
});

test('round and match final tricks collect toward the winner on the same event schedule', () => {
  for (const phase of ['roundEnd', 'finished']) {
    const s = setup(); s.play('red-1'); s.play('blue-2');
    s.state.phase = phase; s.state.completedTricks = 1;
    s.state.events.push({type:'trickEnd',round:2,completedTricks:1,time:1000});
    s.advance(700); s.sync();
    s.advance(TRICK_REVIEW_MS - CARD_COLLECT_MS - CARD_LABEL_FADE_MS / 2 - 700);
    assert.equal(s.motion.labelOpacity(), .5);
    s.advance(CARD_LABEL_FADE_MS / 2 + 400);
    const before = s.motion.pose('red-1');
    assert.ok(before.collect > 0 && before.collect < 1);
    s.state.lifecycle = {paused:true}; s.sync();
    s.advance(10000); s.sync(); assert.deepEqual(s.motion.pose('red-1'), before);
    s.state.lifecycle.paused = false; s.sync();
    s.advance(CARD_COLLECT_MS - 400);
    assert.equal(s.motion.pose('red-1').collect, 1);
    assert.equal(s.motion.pose('blue-2').opacity, 0);
    assert.equal(s.state.phase, phase); assert.equal(s.state.trick.length, 2);
  }
});

test('late manual-result snapshots use the actual trick event without replaying completed collection', () => {
  const state = {phase:'roundEnd',round:2,completedTricks:1,trick:[{card:{id:'red-1'},player:0}],
    events:[{type:'trickEnd',round:1,completedTricks:1,time:9000},
      {type:'trickEnd',round:2,completedTricks:1,time:1000}]};
  const during = new TableMotion(() => 0);
  during.sync(state, {initial:true,serverNow:1000 + TRICK_REVIEW_MS - CARD_COLLECT_MS / 2});
  assert.equal(during.pose('red-1').collect, .5);
  const recovered = new TableMotion(() => 0);
  recovered.sync(state, {initial:true,serverNow:10000});
  assert.equal(recovered.pose('red-1').collect, 1);
  assert.equal(recovered.pose('red-1').opacity, 0);
  assert.equal(recovered.isAnimating(), false);
  // Legacy saves without an event must not invent and replay a newly won trick.
  recovered.sync({...state,events:[]}, {initial:true,serverNow:10000});
  assert.equal(recovered.collectAt, null);
  recovered.sync({...state,events:[]}, {serverNow:11000});
  assert.equal(recovered.collectAt, null);
});

test('all settlement phases recover the persisted collection clock through pause and resume', () => {
  for (const phase of ['trickEnd','roundEnd','finished']) {
    let now = 3450;
    const state = {phase,round:2,completedTricks:1,trick:[{player:0,card:{id:'blue-1'}}],
      events:[{type:'trickEnd',round:2,completedTricks:1,time:1000}],
      lifecycle:{paused:true,collectionAt:null,collectionRemainingMs:550}};
    const motion = new TableMotion(() => now);
    motion.sync(state,{initial:true,serverNow:now});
    assert.equal(motion.pose('blue-1').collect,.5);
    now += 10000;
    motion.sync(state,{serverNow:now});
    assert.equal(motion.pose('blue-1').collect,.5);
    const recovered = new TableMotion(() => now);
    recovered.sync(state,{initial:true,serverNow:now});
    assert.deepEqual(recovered.pose('blue-1'),motion.pose('blue-1'));
    state.lifecycle = {paused:false,collectionAt:now+550,collectionRemainingMs:550};
    recovered.sync(state,{serverNow:now});
    assert.equal(recovered.pose('blue-1').collect,.5);
    now += 550;
    recovered.sync(state,{serverNow:now});
    assert.equal(recovered.pose('blue-1').collect,1);
    assert.equal(recovered.pose('blue-1').opacity,0);
    assert.equal(state.phase,phase);
  }
});
