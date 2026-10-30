import test from 'node:test';
import assert from 'node:assert/strict';
import { trumpPresentation, TrumpReveal, TRUMP_REVEAL_MS } from '../src/trump-display.js';

test('trump display uses the actual turned card, including a wizard after its suit is chosen', () => {
  const reveal = { id: 'blue-9', kind: 'number', suit: 'blue', rank: 9 };
  const numbered = trumpPresentation({ phase: 'bid', trump: 'blue', reveal });
  assert.equal(numbered.card, reveal);
  assert.equal(numbered.label, '本轮主牌：蓝色');
  assert.equal(numbered.compactLabel, '主牌：蓝色');
  const wizard = { id: 'wizard-0', kind: 'wizard' };
  assert.equal(trumpPresentation({ phase: 'trump', trump: null, reveal: wizard }).status, 'pending');
  assert.equal(trumpPresentation({ phase: 'trump', trump: null, reveal: wizard }).compactLabel, '等待庄家选择主牌');
  const chosen = trumpPresentation({ phase: 'bid', trump: 'red', reveal: wizard });
  assert.equal(chosen.card, wizard);
  assert.equal(chosen.suit, 'red');
  assert.match(chosen.label, /巫师指定/);
  assert.equal(chosen.compactLabel, '主牌：红色');
});

test('no-trump states distinguish jester, exhausted deck and monochrome without inventing a card', () => {
  const jester = { id: 'jester-0', kind: 'jester' };
  assert.equal(trumpPresentation({ phase: 'bid', trump: null, reveal: jester }).status, 'jester');
  assert.equal(trumpPresentation({ phase: 'bid', trump: null, reveal: jester }).compactLabel, '本轮无主牌');
  const exhausted = trumpPresentation({ phase: 'bid', trump: null, reveal: null });
  assert.equal(exhausted.status, 'exhausted');
  assert.equal(exhausted.card, null);
  assert.match(exhausted.label, /牌库已用尽/);
  assert.equal(exhausted.compactLabel, '本轮无主牌');
  const mono = trumpPresentation({ phase: 'bid', trump: null, reveal: null, options: { deckMode: 'mono' } });
  assert.equal(mono.card, null);
  assert.equal(mono.label, '本轮无主牌 · 单色牌库');
  assert.equal(mono.compactLabel, '本轮无主牌');
});

function setup() {
  let now = 1000;
  const reveal = new TrumpReveal(() => now);
  const lobby = { phase:'lobby', round:0, eventSeq:0, events:[], trick:[] };
  const state = { phase:'bid', round:1, eventSeq:2, events:[{type:'round',round:1,seq:1,time:1000}],
    reveal:{id:'yellow-9',kind:'number',suit:'yellow',rank:9}, trump:'yellow', trick:[] };
  const sync = (snapshot = state, options = {}) => reveal.sync(snapshot, {scope:'room-a',serverNow:now,...options});
  sync(lobby, {initial:true});
  return {reveal,state,sync,advance:ms=>{now+=ms;}};
}

test('one real round event starts one reveal; duplicate and social snapshots preserve its progress', () => {
  const s = setup(), before = JSON.stringify(s.state); s.sync();
  assert.equal(s.reveal.effect.type, 'reveal');
  assert.equal(s.reveal.effect.display.card, s.state.reveal);
  const effect = s.reveal.effect;
  s.advance(250); s.sync(structuredClone(s.state));
  assert.equal(s.reveal.effect, effect);
  s.sync({...s.state,chat:[{text:'hello'}]}); assert.equal(s.reveal.effect, effect);
  s.advance(TRUMP_REVEAL_MS); s.reveal.draw();
  assert.equal(s.reveal.effect, null);
  s.sync(); assert.equal(s.reveal.effect, null);
  assert.equal(JSON.stringify(s.state), before);
});

test('initial snapshots, reconnects and old round journals settle without replay', () => {
  for (const options of [{initial:true},{scope:'another-room'}]) {
    const s = setup(); s.sync(s.state, options); assert.equal(s.reveal.effect, null);
    s.sync(s.state, options); assert.equal(s.reveal.effect, null);
  }
  const s = setup(); s.advance(TRUMP_REVEAL_MS+1); s.sync(); assert.equal(s.reveal.effect, null);
  const missing = setup(); missing.sync({...missing.state,events:[]}); assert.equal(missing.reveal.effect,null);
  missing.sync(); assert.equal(missing.reveal.effect,null);
});

test('a fresh but delayed round still has a complete extraction and readable hold', () => {
  const s=setup();s.advance(600);s.sync();assert.equal(s.reveal.effect.start,1600);
  s.advance(600);s.reveal.draw();assert.notEqual(s.reveal.effect,null);
  s.advance(TRUMP_REVEAL_MS-600);s.reveal.draw();assert.equal(s.reveal.effect,null);
});

test('wizard reveals the real wizard and pending label; selection emphasizes once without drawing again', () => {
  const s = setup(); Object.assign(s.state,{phase:'trump',trump:null,reveal:{id:'wizard-0',kind:'wizard'}});
  s.sync(); assert.equal(s.reveal.effect.display.card.kind,'wizard');
  assert.equal(s.reveal.effect.display.label,'等待庄家选择主牌');
  s.advance(120); Object.assign(s.state,{phase:'bid',trump:'red',eventSeq:3}); s.sync();
  assert.equal(s.reveal.effect,null); assert.equal(s.reveal.display.compactLabel,'主牌：红色');
  const at = s.reveal.pulseAt; assert.notEqual(at,null);
  s.advance(80); s.sync(); assert.equal(s.reveal.pulseAt,at);
});

test('jester shows its actual face; absent reveals only fade the no-trump text', () => {
  const jester = setup(); Object.assign(jester.state,{trump:null,reveal:{id:'jester-1',kind:'jester'}});
  jester.sync(); assert.equal(jester.reveal.effect.type,'reveal');
  assert.equal(jester.reveal.effect.display.card.kind,'jester');
  assert.match(jester.reveal.effect.display.label,/本轮无主牌/);
  for (const options of [{},{deckMode:'mono'}]) {
    const s = setup(); Object.assign(s.state,{trump:null,reveal:null,options}); s.sync();
    assert.equal(s.reveal.effect.type,'text'); assert.equal(s.reveal.effect.display.card,null);
    s.advance(221); s.reveal.draw(); assert.equal(s.reveal.effect,null);
  }
});

test('motion off, pause, played cards, room changes and cancellation cannot revive an old reveal', () => {
  const s = setup(); s.sync(); s.reveal.finish(); s.sync(); assert.equal(s.reveal.effect,null);
  for (const [change,options] of [[{}, {motion:false}],[{lifecycle:{paused:true}},{}],[{trick:[{card:{id:'red-1'}}]},{}]]) {
    const item=setup();item.sync({...item.state,...change},options);assert.equal(item.reveal.effect,null);
    item.sync();assert.equal(item.reveal.effect,null);
  }
  s.sync(null);assert.equal(s.reveal.effect,null);assert.equal(s.reveal.display,null);
});

test('each subsequent round uses its own event even when the same card is turned again', () => {
  const s=setup(); s.sync(); const first=s.reveal.effect.key;
  const next={...s.state,round:2,eventSeq:10,events:[{type:'round',seq:9,round:2,time:1000}]};
  s.sync(next);assert.notEqual(s.reveal.effect.key,first);assert.equal(s.reveal.effect.display.card,s.state.reveal);
  s.advance(500);s.sync(s.state,{initial:true});assert.equal(s.reveal.effect,null);
});

test('readable reveal hold sleeps until returning, then settles without further frames', () => {
  const s = setup(); s.sync();
  assert.equal(s.reveal.nextUpdateDelay(), 0);
  s.advance(800);
  assert.equal(s.reveal.nextUpdateDelay(), 1100);
  s.advance(1100);
  assert.equal(s.reveal.nextUpdateDelay(), 0);
  s.advance(500); s.reveal.draw();
  assert.equal(s.reveal.nextUpdateDelay(), 0); // confirmed icon pulse
  s.advance(321); s.reveal.draw();
  assert.equal(s.reveal.nextUpdateDelay(), null);
});
