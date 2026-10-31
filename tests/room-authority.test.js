import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomAuthority, NORMAL_RETENTION_MS, PAUSED_RETENTION_MS, CONTINUATION_MS, RESULTS_MS, RECONNECT_GRACE_MS } from '../worker/room-authority.js';
import { DEFAULT_OPTIONS } from '../src/rules-options.js';

function setup() {
  let now = 100000;
  const room = new RoomAuthority(undefined, now);
  const host = room.join('host-hash', { host: true, name: '房主' }, now);
  const a = room.join('a-hash', { name: '甲' }, now);
  const b = room.join('b-hash', { name: '乙' }, now);
  const send = (who, message) => room.handle(who, message, now);
  const advance = ms => { now += ms; room.tick(now); };
  const start = () => {
    send(host, { type: 'action', action: { type: 'configure', options: { ...DEFAULT_OPTIONS, short: true } } });
    send(host, { type: 'action', action: { type: 'start' } });
    if (room.game.phase === 'trump') send([host, a, b].find(i => i.id === room.game.players[room.game.turn].id), { type: 'action', action: { type: 'trump', suit: 'blue' } });
    while (room.game.phase === 'bid') send([host, a, b].find(i => i.id === room.game.players[room.game.turn].id), { type: 'action', action: { type: 'bid', value: 0 } });
  };
  return { room, host, a, b, send, advance, start, now: () => now };
}

test('ordinary host retention is 30m from last effective disconnect; other activity cannot renew it', () => {
  const s = setup();
  s.room.disconnect(s.host.id, s.now());
  const deadline = s.now() + NORMAL_RETENTION_MS;
  assert.equal(s.room.life.retentionDeadline, deadline);
  s.advance(10000); s.send(s.a, { type: 'action', action: { type: 'chat', text: '在线' } });
  assert.equal(s.room.life.retentionDeadline, deadline);
  s.room.join('host-hash', { host: true }, s.now());
  assert.equal(s.room.life.retentionDeadline, null);
  s.advance(NORMAL_RETENTION_MS * 3);
  assert.equal(s.room.closed, false, 'online host never expires through inactivity');
  s.room.disconnect(s.host.id, s.now()); s.advance(NORMAL_RETENTION_MS);
  assert.equal(s.room.closed, true, 'lobby closes directly at deadline');
});

test('same active pause fixes its first-offline 4h deadline; refresh cannot extend it; formal resume starts a new pause', () => {
  const s = setup(); s.send(s.host, { type: 'pause', reason: '休息' });
  s.room.disconnect(s.host.id, s.now());
  const deadline = s.now() + PAUSED_RETENTION_MS;
  s.advance(1000); s.room.join('host-hash', { host: true }, s.now());
  s.advance(1000); s.room.disconnect(s.host.id, s.now());
  assert.equal(s.room.life.retentionDeadline, deadline);
  s.room.join('host-hash', { host: true }, s.now()); s.send(s.host, { type: 'resume' });
  s.send(s.host, { type: 'pause' }); s.room.disconnect(s.host.id, s.now());
  assert.equal(s.room.life.retentionDeadline, s.now() + PAUSED_RETENTION_MS);
  s.advance(PAUSED_RETENTION_MS);
  assert.equal(s.room.closed, true);
});

test('pause freezes time, AI and selections while chat and room inspection remain available', () => {
  const s = setup(); s.start();
  s.advance(4000);
  const remaining = s.room.game.turnDeadline - s.now();
  const hand = structuredClone(s.room.game.players.map(p => p.hand));
  s.send(s.host, { type: 'pause' });
  s.send(s.a, { type: 'action', action: { type: 'chat', text: '稍等' } });
  s.advance(PAUSED_RETENTION_MS * 2);
  assert.deepEqual(s.room.game.players.map(p => p.hand), hand);
  assert.equal(s.room.game.turnDeadline, null);
  assert.equal(s.room.view(s.a, 0, s.now()).lifecycle.remainingMs, remaining);
  assert.throws(() => s.send(s.a, { type: 'action', action: { type: 'play', card: hand[1][0].id } }), /暂停/);
  assert.throws(() => s.send(s.a, { type: 'resume' }), /房主/);
  s.send(s.host, { type: 'resume' });
  assert.equal(s.room.game.turnDeadline, s.now() + remaining);
});

test('current player disconnect freezes remaining budget for reconnect grace without treating it as room pause', () => {
  const s = setup(); s.start(); s.advance(5000);
  const current = [s.host, s.a, s.b].find(p => p.id === s.room.game.players[s.room.game.turn].id);
  const remaining = s.room.game.turnDeadline - s.now();
  s.room.disconnect(current.id, s.now());
  assert.equal(s.room.life.paused, false); assert.equal(s.room.game.turnDeadline, null);
  s.advance(2000);
  s.room.join(current.id === s.host.id ? 'host-hash' : current.id === s.a.id ? 'a-hash' : 'b-hash', { host: current.id === s.host.id }, s.now());
  assert.equal(s.room.game.turnDeadline, s.now() + remaining);
  s.room.disconnect(current.id, s.now()); s.advance(RECONNECT_GRACE_MS);
  assert.equal(s.room.game.turnDeadline, s.now() + remaining - 2000, 'a repeated drop shares the original 20-second freeze allowance');
  assert.equal(s.room.game.trick.length, 0);
});

test('repeated disconnects share a 20-second freeze pool and a 10-second operation-floor pool per opportunity', () => {
  const s = setup(); s.start(); s.advance(44450);
  const actor = [s.host, s.a, s.b].find(p => p.id === s.room.game.players[s.room.game.turn].id);
  const hash = actor.id === s.host.id ? 'host-hash' : actor.id === s.a.id ? 'a-hash' : 'b-hash';
  const originalDeadline = s.room.game.turnDeadline;
  const reconnect = () => s.room.join(hash, { host: actor.id === s.host.id }, s.now());
  const legal = s.room.view(actor, 0, s.now()).legal;
  s.room.disconnect(actor.id, s.now());
  const waiting = s.room.view(s.host, 0, s.now()).lifecycle;
  assert.equal(waiting.reconnecting, true);
  assert.equal(waiting.reconnectPlayerId, actor.id);
  assert.equal(waiting.reconnectRemainingMs, 20000);
  assert.equal(waiting.reconnectUntil, s.now() + 20000);
  s.advance(5000); reconnect();
  assert.equal(s.room.game.turnDeadline - s.now(), 10000);
  assert.equal(s.room.record.turnProtection.freezeRemainingMs, 15000);
  assert.equal(s.room.record.turnProtection.reconnectCreditMs, 1000);
  s.advance(9000); s.room.disconnect(actor.id, s.now());
  s.advance(1000); reconnect();
  assert.equal(s.room.game.turnDeadline - s.now(), 2000, 'only the final second of operation-floor credit remains');
  assert.equal(s.room.record.turnProtection.reconnectCreditMs, 0);
  s.room.disconnect(actor.id, s.now()); s.advance(14000);
  assert.equal(s.room.record.turnProtection.freezeRemainingMs, 0);
  assert.equal(s.room.view(s.host, 0, s.now()).lifecycle.reconnecting, false);
  s.advance(1000); reconnect();
  assert.equal(s.room.game.turnDeadline, originalDeadline + 30000, 'all protection extensions are bounded to 30 seconds');
  assert.equal(s.room.game.turnDeadline - s.now(), 1000);
  s.room.disconnect(actor.id, s.now());
  assert.equal(s.room.view(s.host, 0, s.now()).lifecycle.reconnecting, false, 'empty pools cannot restart protection');
  s.advance(1000);
  assert.equal(s.room.game.trick.length, 1);
  assert.ok(legal.includes(s.room.game.trick[0].card.id));
});

test('room pause suspends reconnect protection and persistence preserves the remaining allowance', () => {
  const s = setup(); s.start(); s.room.game.turnDeadline = s.now() + 1000;
  const current = [s.host, s.a, s.b].find(p => p.id === s.room.game.players[s.room.game.turn].id);
  s.room.disconnect(current.id, s.now()); s.advance(5000);
  s.send(s.host, { type: 'pause' });
  assert.equal(s.room.record.turnProtection.freezeRemainingMs, 15000);
  assert.equal(s.room.record.turnProtection.holdUntil, null);
  s.advance(60000);
  const restored = new RoomAuthority(structuredClone(s.room.record), s.now());
  assert.equal(restored.record.turnProtection.freezeRemainingMs, 15000);
  assert.equal(restored.record.frozen.remaining, 1000);
  restored.handle(s.host, { type: 'resume' }, s.now());
  assert.equal(restored.view(s.host, 0, s.now()).lifecycle.reconnectUntil, s.now() + 15000);
  restored.tick(s.now() + 2000);
  restored.join(current.id === s.a.id ? 'a-hash' : current.id === s.b.id ? 'b-hash' : 'host-hash', { host: current.id === s.host.id }, s.now() + 2000);
  assert.equal(restored.game.turnDeadline, s.now() + 12000);
  assert.equal(restored.record.turnProtection.freezeRemainingMs, 13000);
  assert.equal(restored.record.turnProtection.reconnectCreditMs, 1000);
});

test('delayed grace alarms thaw at the actual boundary and cannot rescue an expired opportunity on reconnect', () => {
  for (const reconnect of [false, true]) {
    const s = setup(); s.start(); s.room.game.turnDeadline = s.now() + 1000;
    const current = [s.host, s.a, s.b].find(p => p.id === s.room.game.players[s.room.game.turn].id);
    const legal = s.room.view(current, 0, s.now()).legal;
    s.room.disconnect(current.id, s.now());
    const late = s.now() + 25000;
    const restored = new RoomAuthority(structuredClone(s.room.record), late);
    if (reconnect) restored.join(current.id === s.a.id ? 'a-hash' : current.id === s.b.id ? 'b-hash' : 'host-hash', { host: current.id === s.host.id }, late);
    else restored.tick(late);
    assert.equal(restored.game.trick.length, 1);
    assert.ok(legal.includes(restored.game.trick[0].card.id));
  }
});

test('reconnect after grace expiration can still spend operation-floor credit before its original clock expires', () => {
  const s = setup(); s.start(); s.room.game.turnDeadline = s.now() + 1000;
  const actor = [s.host, s.a, s.b].find(p => p.id === s.room.game.players[s.room.game.turn].id);
  s.room.disconnect(actor.id, s.now()); s.advance(20500);
  s.room.join(actor.id === s.a.id ? 'a-hash' : actor.id === s.b.id ? 'b-hash' : 'host-hash', { host: actor.id === s.host.id }, s.now());
  assert.equal(s.room.game.turnDeadline - s.now(), 10000);
  assert.equal(s.room.record.turnProtection.freezeRemainingMs, 0);
  assert.equal(s.room.record.turnProtection.reconnectCreditMs, 500);
});

test('legacy missing turn clocks migrate once while finite deadlines, zero budgets and old frozen holds keep their timing', () => {
  const s = setup(); s.start();
  const record = structuredClone(s.room.record);
  delete record.game.turnDeadline; delete record.turnProtection;
  const restored = new RoomAuthority(record, s.now());
  assert.equal(restored.game.turnDeadline, s.now() + 45450);
  restored.tick(s.now() + 1000);
  assert.equal(restored.game.turnDeadline, s.now() + 45450, 'tick cannot replenish a missing-clock migration');
  for (const remaining of [0, 30000]) {
    const paused = structuredClone(s.room.record);
    paused.lifecycle.paused = true; paused.game.turnDeadline = null;
    paused.frozen = { remaining, taskRemaining: null };
    const old = new RoomAuthority(paused, s.now() + 1000);
    assert.equal(old.record.frozen.remaining, remaining);
    old.handle(s.host, { type: 'resume' }, s.now() + 1000);
    assert.equal(old.game.turnDeadline, s.now() + 1000 + remaining);
  }
  const finite = structuredClone(s.room.record); finite.game.turnDeadline = s.now() + 30000;
  assert.equal(new RoomAuthority(finite, s.now()).game.turnDeadline, s.now() + 30000);
  const legacy = structuredClone(s.room.record), current = legacy.game.players[legacy.game.turn];
  current.online = false; legacy.game.turnDeadline = null; delete legacy.turnProtection;
  legacy.frozen = { remaining: 1000, taskRemaining: null };
  legacy.reconnectUntil[current.id] = s.now() + 8000;
  const oldHold = new RoomAuthority(legacy, s.now() + 2000);
  assert.equal(oldHold.record.turnProtection.freezeRemainingMs, 6000);
  assert.equal(oldHold.record.turnProtection.holdUntil, s.now() + 8000);
  oldHold.tick(s.now() + 8500);
  assert.equal(oldHold.game.turnDeadline, s.now() + 9000);
});

test('pausing after a delayed protection boundary freezes only the real remaining play time', () => {
  const s = setup(); s.start(); s.room.game.turnDeadline = s.now() + 5000;
  const actor = [s.host, s.a, s.b].find(p => p.id === s.room.game.players[s.room.game.turn].id);
  s.room.disconnect(actor.id, s.now());
  s.room.handle(s.host, { type: 'pause' }, s.now() + 23000);
  assert.equal(s.room.record.frozen.remaining, 2000);
  assert.equal(s.room.record.turnProtection.freezeRemainingMs, 0);
  s.room.handle(s.host, { type: 'resume' }, s.now() + 60000);
  assert.equal(s.room.game.turnDeadline, s.now() + 62000);
});

test('expiry snapshots online humans only and a returning owner cannot cancel the 60s vote', () => {
  const s = setup(); s.start();
  s.room.disconnect(s.host.id, s.now());
  s.advance(NORMAL_RETENTION_MS);
  const vote = s.room.life.continuationVote;
  assert.deepEqual(vote.voters, [s.a.id, s.b.id]);
  assert.equal(vote.deadline, s.now() + CONTINUATION_MS);
  s.room.join('host-hash', { host: true }, s.now());
  assert.ok(s.room.life.continuationVote);
  assert.throws(() => s.send(s.host, { type: 'resume' }), /不会取消/);
  assert.throws(() => s.send(s.host, { type: 'continuationVote', accept: true }), /不能参与/);
  s.send(s.a, { type: 'continuationVote', accept: true });
  s.send(s.b, { type: 'continuationVote', accept: false });
  assert.equal(s.room.closed, true);
});

test('vote nonresponse and missing online humans close without reviving a room', () => {
  const s = setup(); s.start(); s.room.disconnect(s.host.id, s.now());
  s.advance(NORMAL_RETENTION_MS); s.send(s.a, { type: 'continuationVote', accept: true });
  s.advance(CONTINUATION_MS);
  assert.equal(s.room.closed, true);
  assert.throws(() => s.room.join('host-hash', { host: true }, s.now()), /已关闭/);
  const noHumans = setup(); noHumans.start();
  for (const who of [noHumans.host, noHumans.a, noHumans.b]) noHumans.room.disconnect(who.id, noHumans.now());
  noHumans.advance(NORMAL_RETENTION_MS);
  assert.equal(noHumans.room.closed, true);
});

test('unanimous continuation substitutes offline seats, scores once, forbids another round and has bounded result wait', () => {
  const s = setup(); s.start(); s.send(s.host, { type: 'pause' });
  s.room.disconnect(s.host.id, s.now()); s.advance(PAUSED_RETENTION_MS);
  s.send(s.a, { type: 'continuationVote', accept: true }); s.send(s.b, { type: 'continuationVote', accept: true });
  assert.equal(s.room.life.closeAfterRound, true); assert.equal(s.room.life.paused, false);
  assert.throws(() => s.send(s.a, { type: 'action', action: { type: 'rematch' } }), /续赛/);
  let budget = 30;
  while (!s.room.life.resultsDeadline && budget-- > 0) {
    if (s.room.game.phase === 'play') {
      const current = [s.a, s.b].find(i => i.id === s.room.game.players[s.room.game.turn].id);
      if (current) {
        const card = s.room.view(current, 0, s.now()).legal[0];
        s.send(current, { type: 'action', action: { type: 'play', card } });
      }
    }
    s.advance(1600);
  }
  assert.equal(s.room.game.history.length, 1);
  assert.ok(s.room.life.resultsDeadline <= s.now() + RESULTS_MS);
  assert.ok(s.room.life.resultsDeadline >= s.now() + RESULTS_MS - 1600);
  const round = s.room.game.round;
  s.room.join('host-hash', { host: true }, s.now());
  assert.equal(s.room.life.closeAfterRound, true);
  assert.throws(() => s.send(s.host, { type: 'action', action: { type: 'next' } }), /结束后关闭/);
  s.advance(RESULTS_MS);
  assert.equal(s.room.closed, true); assert.equal(s.room.game.round, round); assert.equal(s.room.game.history.length, 1);
});

test('persisted authority resumes exact hands, timer remainder, ballots and fixed pause deadline', () => {
  const s = setup(); s.start(); s.send(s.host, { type: 'pause' }); s.room.disconnect(s.host.id, s.now());
  const save = structuredClone(s.room.record);
  const resumed = new RoomAuthority(save, s.now() + 1000);
  resumed.join('host-hash', { host: true }, s.now() + 1000);
  assert.deepEqual(resumed.game.players.map(p => p.hand), s.room.game.players.map(p => p.hand));
  assert.equal(resumed.life.retentionDeadline, s.room.life.retentionDeadline);
  assert.equal(resumed.view(s.a).lifecycle.remainingMs, s.room.view(s.a).lifecycle.remainingMs);
  assert.equal(Object.hasOwn(resumed.view(s.host), 'randomState'), false);
  assert.equal(JSON.stringify(resumed.view(s.a)).includes('host-hash'), false);
});

test('paused AI task resumes its exact remaining delay instead of playing during pause or restarting the delay', () => {
  const s = setup(); s.start();
  s.room.game.players[s.room.game.turn].bot = true;
  s.room.schedule(s.now());
  s.advance(250); s.send(s.host, { type: 'pause' });
  assert.equal(s.room.record.frozen.taskRemaining, 500);
  s.advance(PAUSED_RETENTION_MS * 2);
  assert.equal(s.room.game.trick.length, 0);
  s.send(s.host, { type: 'resume' });
  s.advance(499); assert.equal(s.room.game.trick.length, 0);
  s.advance(1); assert.equal(s.room.game.trick.length, 1);
});

test('host options survive authority persistence and guests cannot edit them', () => {
  const s = setup(), options = { ...DEFAULT_OPTIONS, predictionMode: 'secret', foresight: true };
  s.send(s.host, { type: 'action', action: { type: 'configure', options } });
  const resumed = new RoomAuthority(structuredClone(s.room.record), s.now());
  assert.deepEqual(resumed.game.options, options);
  assert.deepEqual(resumed.view(s.a).options, options);
  assert.throws(() => resumed.handle(s.a, { type: 'action', action: { type: 'configure', options: DEFAULT_OPTIONS } }, s.now()), /房主/);
  assert.equal(resumed.view(s.host).vote, undefined);
});

test('every online human result confirmation closes a completed continuation before the upper deadline', () => {
  const s = setup(); s.start(); s.send(s.host, { type: 'pause' });
  s.room.disconnect(s.host.id, s.now()); s.advance(PAUSED_RETENTION_MS);
  s.send(s.a, { type: 'continuationVote', accept: true }); s.send(s.b, { type: 'continuationVote', accept: true });
  while (!s.room.life.resultsDeadline) {
    const current = [s.a, s.b].find(i => i.id === s.room.game.players[s.room.game.turn].id);
    if (s.room.game.phase === 'play' && current) s.send(current, { type: 'action', action: { type: 'play', card: s.room.view(current).legal[0] } });
    s.advance(1600);
  }
  s.send(s.a, { type: 'confirmResults' }); assert.equal(s.room.closed, false);
  s.send(s.b, { type: 'confirmResults' }); assert.equal(s.room.closed, true);
});

test('a previously disconnected next seat receives its full new turn budget after reconnect', () => {
  const s = setup(); s.start();
  s.room.game.turn = 0;
  s.room.game.turnDeadline = s.now() + 30000;
  s.room.disconnect(s.a.id, s.now());
  s.advance(2000);
  const card = s.room.view(s.host, 0, s.now()).legal[0];
  s.send(s.host, { type: 'action', action: { type: 'play', card } });
  assert.equal(s.room.game.turn, 1);
  assert.equal(s.room.game.turnDeadline, null);
  assert.equal(s.room.record.frozen.remaining, 45450);
  s.advance(4000);
  s.room.join('a-hash', {}, s.now());
  assert.equal(s.room.game.turnDeadline - s.now(), 45450);
});

test('a system bot handoff also freezes a previously disconnected next seat budget', () => {
  const s = setup(); s.start();
  s.room.game.turn = 0; s.room.game.turnDeadline = s.now() + 30000;
  s.room.game.players[0].bot = true;
  s.room.schedule(s.now());
  s.room.disconnect(s.a.id, s.now());
  s.advance(1000);
  assert.equal(s.room.game.turn, 1);
  assert.equal(s.room.game.turnDeadline, null);
  assert.equal(s.room.record.frozen.remaining, 45450);
  s.advance(3000); s.room.join('a-hash', {}, s.now());
  assert.equal(s.room.game.turnDeadline - s.now(), 45450);
});

test('trick results hold for three seconds and pausing preserves the remaining review instead of skipping it', () => {
  const s = setup(); s.start();
  Object.assign(s.room.game, { round: 2, cardsPerRound: 2, completedTricks: 0, turn: 0, trump: null });
  s.room.game.players.forEach((p, i) => { p.hand = [1, 2].map(n => ({ id: `blue-${i * 2 + n}`, kind: 'number', suit: 'blue', rank: i * 2 + n })); });
  for (const who of [s.host, s.a, s.b]) s.send(who, { type: 'action', action: { type: 'play', card: s.room.game.players.find(p => p.id === who.id).hand[0].id } });
  assert.equal(s.room.game.phase, 'trickEnd');
  assert.equal(s.room.view(s.a, 0, s.now()).lifecycle.reviewRemainingMs, 3000);
  assert.throws(() => s.send(s.host, { type: 'action', action: { type: 'next' } }), /看完/);
  s.advance(2000); assert.equal(s.room.game.phase, 'trickEnd');
  s.send(s.host, { type: 'pause' }); s.advance(60000);
  assert.equal(s.room.view(s.a, 0, s.now()).lifecycle.reviewRemainingMs, 1000);
  const legacy = structuredClone(s.room.record); delete legacy.collection; delete legacy.frozen.collectionRemaining;
  const upgraded = new RoomAuthority(legacy,s.now());
  assert.equal(upgraded.view(s.a,0,s.now()).lifecycle.collectionRemainingMs,1000,'upgrading a paused ordinary trick keeps its authoritative remaining review');
  s.send(s.a, { type: 'action', action: { type: 'chat', text: '看看胜因' } });
  s.send(s.host, { type: 'resume' }); s.advance(999);
  assert.equal(s.room.game.phase, 'trickEnd'); s.advance(1);
  assert.equal(s.room.game.phase, 'play'); assert.equal(s.room.game.turn, 2);
  assert.equal(s.room.game.turnDeadline, s.now() + 45450);
});

test('final-trick collection survives paused authority reconstruction without advancing round or match results', () => {
  for (const target of ['roundEnd','finished']) {
    const s = setup(); s.start();
    const identities = [s.host,s.a,s.b];
    for (let guard = 0; s.room.game.phase !== target && guard < 250; guard++) {
      const game = s.room.game;
      const actor = identities.find(identity => identity.id === game.players[game.turn].id);
      const view = s.room.view(actor,0,s.now());
      if (game.phase === 'trump') s.send(actor,{type:'action',action:{type:'trump',suit:'blue'}});
      else if (game.phase === 'bid') s.send(actor,{type:'action',action:{type:'bid',value:view.bids[0]}});
      else if (game.phase === 'play') s.send(actor,{type:'action',action:{type:'play',card:view.legal[0]}});
      else if (game.phase === 'trickEnd') s.advance(3000);
      else if (game.phase === 'roundEnd') s.send(s.host,{type:'action',action:{type:'next'}});
      else assert.fail(`Unexpected phase ${game.phase}`);
    }
    assert.equal(s.room.game.phase,target);
    const won = structuredClone({history:s.room.game.history,players:s.room.game.players,randomState:s.room.game.randomState});
    assert.equal(s.room.record.task,null,'manual results never get an automatic advancement task');
    assert.equal(s.room.view(s.a,0,s.now()).lifecycle.collectionAt,s.now()+3000);
    s.advance(2450); s.send(s.host,{type:'pause'});
    assert.equal(s.room.view(s.a,0,s.now()).lifecycle.collectionRemainingMs,550);
    assert.equal(s.room.view(s.a,0,s.now()).lifecycle.collectionAt,null);
    const recoveredAt = s.now()+10000;
    const restored = new RoomAuthority(structuredClone(s.room.record),recoveredAt);
    restored.join('host-hash',{host:true},recoveredAt);
    restored.handle(s.a,{type:'action',action:{type:'chat',text:'暂停刷新后继续'}},recoveredAt);
    assert.equal(restored.view(s.a,0,recoveredAt).lifecycle.collectionRemainingMs,550);
    restored.handle(s.host,{type:'resume'},recoveredAt);
    assert.equal(restored.view(s.a,0,recoveredAt).lifecycle.collectionAt,recoveredAt+550);
    restored.tick(recoveredAt+550);
    assert.equal(restored.game.phase,target);
    assert.equal(restored.view(s.a,0,recoveredAt+550).lifecycle.collectionRemainingMs,0);
    assert.deepEqual({history:restored.game.history,players:restored.game.players,randomState:restored.game.randomState},won);
    restored.handle(s.host,{type:'action',action:{type:target==='finished'?'rematch':'next'}},recoveredAt+550);
    assert.equal(restored.record.collection,null,'the next round cannot inherit the old collection clock');
  }
});

test('legacy paused result records use their old event age without replaying collection', () => {
  const s = setup(); s.start();
  for (let count = 0; s.room.game.phase === 'play' && count < 3; count++) {
    const actor = [s.host,s.a,s.b].find(identity => identity.id === s.room.game.players[s.room.game.turn].id);
    s.send(actor,{type:'action',action:{type:'play',card:s.room.view(actor,0,s.now()).legal[0]}});
  }
  assert.equal(s.room.game.phase,'roundEnd');
  s.send(s.host,{type:'pause'});
  const record = structuredClone(s.room.record);
  delete record.collection; delete record.frozen.collectionRemaining;
  const restored = new RoomAuthority(record,s.now()+10000);
  assert.equal(restored.view(s.a,0,s.now()+10000).lifecycle.collectionRemainingMs,0);
  const noEvent = structuredClone(record); noEvent.game.events=[]; delete noEvent.collection;
  const older = new RoomAuthority(noEvent,s.now()+10000);
  assert.equal(older.view(s.a,0,s.now()+10000).lifecycle.collectionAt,null);
  assert.equal(older.view(s.a,0,s.now()+10000).lifecycle.collectionRemainingMs,null);
  assert.equal(older.game.phase,'roundEnd');
});
