import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, addPlayer, act, viewFor, spectatorView, legalCards, leadSuit, botAction, deck, monoDeck } from '../src/game.js';
import { createRandomStream } from '../src/random.js';
import { DEFAULT_OPTIONS } from '../src/rules-options.js';
import { RoomAuthority } from '../worker/room-authority.js';
import { followSuitHint, playBlockedReason } from '../src/hand-model.js';

const number = (suit, rank) => ({ id: `${suit}-${rank}`, kind: 'number', suit, rank });
const wizard = { id: 'wizard-0', kind: 'wizard' }, jester = { id: 'jester-0', kind: 'jester' };
const plays = cards => cards.map((card, player) => ({ player, card }));
const optionsFor = deckMode => ['public', 'hidden', 'secret'].flatMap(predictionMode =>
  (predictionMode === 'public' ? [false, true] : [false]).flatMap(strict =>
    [false, true].flatMap(foresight => [false, true].map(short => ({ deckMode, predictionMode, strict, foresight, short })))));

// Independent rule assertions: do not choose cards or winners with the engine
// functions being audited. Earlier equal-strength cards retain the trick.
function expectedLegal(g, hand) {
  let suit;
  if (g.options.deckMode !== 'mono') for (const { card } of g.trick) {
    if (card.kind === 'jester') continue;
    if (card.kind === 'number') suit = card.suit;
    break;
  }
  const mustFollow = suit && hand.some(card => card.kind === 'number' && card.suit === suit);
  return hand.filter(card => !mustFollow || card.kind !== 'number' || card.suit === suit).map(card => card.id);
}
function expectedWinner(g, trick) {
  const firstNumber = trick.find(play => play.card.kind === 'number')?.card.suit;
  const power = ({ card }) => card.kind === 'wizard' ? 1000 : card.kind === 'jester' ? 0 :
    g.options.deckMode === 'mono' ? card.rank : card.suit === g.trump ? 100 + card.rank : card.suit === firstNumber ? 20 + card.rank : 1;
  return trick.reduce((best, play) => power(play) > power(best) ? play : best).player;
}
function room(options, count = 3) {
  const g = createGame();
  for (let i = 0; i < count; i++) addPlayer(g, `p${i}`, `玩家${i}`);
  g.options = { ...DEFAULT_OPTIONS, ...options };
  return g;
}

test('every standard variant follows the led color, including trump and later wizards; rejection is atomic', () => {
  for (const options of optionsFor('standard')) for (const suit of ['blue', 'red', 'green', 'yellow']) {
    const off = suit === 'blue' ? 'red' : 'blue';
    for (const prefix of [[number(suit, 7)], [jester, number(suit, 7)], [number(suit, 7), wizard], [jester, number(suit, 7), wizard]]) {
      const g = room(options, 6), turn = prefix.length;
      Object.assign(g, { phase: 'play', turn, round: 2, cardsPerRound: 2, completedTricks: 0, trump: off, trick: plays(prefix) });
      g.players[turn].hand = [number(suit, 2), number(off, 13), { ...wizard, id: 'wizard-1' }, { ...jester, id: 'jester-1' }];
      const expected = [number(suit, 2).id, 'wizard-1', 'jester-1'];
      assert.deepEqual(viewFor(g, `p${turn}`).legal, expected);
      const before = structuredClone(g);
      assert.throws(() => act(g, `p${turn}`, { type: 'play', card: number(off, 13).id }), /必须跟色/);
      assert.deepEqual(g, before);
      for (const id of expected) {
        const copy = structuredClone(g);
        act(copy, `p${turn}`, { type: 'play', card: id });
        assert.equal(copy.trick.at(-1).card.id, id);
      }
    }
  }
});

test('leading W, J then W, all-J prefixes, void hands and monochrome have the required exemptions', () => {
  const hand = [number('red', 2), number('blue', 13), wizard, jester];
  for (const prefix of [[], [jester], [jester, { ...jester, id: 'jester-1' }], [wizard, number('red', 7)], [jester, wizard, number('red', 7)]]) {
    assert.equal(leadSuit(plays(prefix)), null);
    assert.deepEqual(legalCards(hand, plays(prefix)), hand);
  }
  assert.deepEqual(legalCards([number('blue', 13), wizard, jester], plays([number('red', 7)])), [number('blue', 13), wizard, jester]);
  assert.equal(leadSuit(plays([number('red', 7)]), 'mono'), null);
  assert.deepEqual(legalCards(hand, plays([number('red', 7)]), 'mono'), hand);
});

test('simple and smart bots and the timeout fallback obey follow suit in every standard variant', () => {
  for (const options of optionsFor('standard')) {
    const g = room(options);
    Object.assign(g, { phase: 'play', turn: 1, round: 2, cardsPerRound: 2, completedTricks: 0, turnDeadline: 1000, trump: 'blue', trick: plays([number('red', 7)]) });
    Object.assign(g.players[1], { bot: true, bid: 1, hand: [number('blue', 1), number('red', 10)] });
    for (const difficulty of ['simple', 'smart']) assert.deepEqual(botAction(g, 'p1', difficulty), { type: 'play', card: 'red-10' });
    act(g, 'p0', { type: 'timeout' }, undefined, 1000);
    assert.equal(g.trick.at(-1).card.id, 'red-10');
  }
});

test('authenticated room authority rejects off-suit messages after persistence and still follows suit on timeout', () => {
  for (const options of optionsFor('standard')) {
    const original = new RoomAuthority(undefined, 0);
    const identities = ['host', 'guest', 'third'].map((hash, i) => original.join(hash, { host: i === 0, name: `玩家${i}` }, 0));
    const g = original.game;
    Object.assign(g, { options, phase: 'play', turn: 1, round: 2, cardsPerRound: 2, completedTricks: 0, turnDeadline: 1000, trump: 'blue', trick: plays([number('red', 7)]) });
    g.players[1].hand = [number('blue', 1), number('red', 10)];
    const restored = new RoomAuthority(structuredClone(original.record), 0);
    assert.deepEqual(restored.view(identities[1], 0, 0).legal, ['red-10']);
    const before = structuredClone(restored.record);
    assert.throws(() => restored.handle(identities[1], { type: 'action', action: { type: 'play', card: 'blue-1', suit: 'red', timedOut: true } }, 0), /必须跟色/);
    assert.deepEqual(restored.record, before);
    restored.tick(1000);
    assert.equal(restored.game.trick.at(-1).card.id, 'red-10');
  }
});

test('follow-suit prompts distinguish a required color, void hand, leading W and monochrome', () => {
  const g = room();
  Object.assign(g, { phase: 'play', turn: 1, trick: plays([number('red', 7)]) });
  g.players[1].hand = [number('red', 2), number('blue', 13), wizard, jester];
  let v = viewFor(g, 'p1');
  assert.match(followSuitHint(v, 'p1'), /须跟红色/);
  assert.match(playBlockedReason(v, 'p1', number('blue', 13)), /有红色牌/);
  for (const card of [wizard, jester, number('red', 2)]) assert.equal(playBlockedReason(v, 'p1', card), '');
  g.players[1].hand = [number('blue', 13)];
  assert.match(followSuitHint(viewFor(g, 'p1'), 'p1'), /没有红色/);
  assert.match(followSuitHint(viewFor(g, 'p0'), 'p0'), /须跟红色/);
  g.trick = plays([wizard, number('red', 7)]);
  assert.equal(followSuitHint(viewFor(g, 'p1'), 'p1'), '本墩可自由出牌');
  g.options.deckMode = 'mono';
  assert.match(followSuitHint(viewFor(g, 'p1'), 'p1'), /单色牌库不跟花色/);
});

for (const deckMode of ['standard', 'mono']) test(`all ${deckMode} player counts and legal option combinations finish with independently checked deals, bids, tricks and scores`, () => {
  let cases = 0;
  for (const count of deckMode === 'mono' ? [3, 4] : [3, 4, 5, 6]) for (const options of optionsFor(deckMode)) {
    const g = room(options, count);
    g.randomState = createRandomStream(Array.from({ length: 11 }, (_, i) => 37 * (i + 1) + cases));
    act(g, 'p0', { type: 'start' }, undefined, 0);
    const maxRounds = options.short ? 5 : deckMode === 'mono' ? 12 : 60 / count;
    let observedRound = 0, rejected = false, steps = 0;
    while (g.phase !== 'finished' && ++steps < 10000) {
      assert.deepEqual(g.options, options);
      assert.equal(g.maxRounds, maxRounds);
      if (g.round !== observedRound) {
        observedRound = g.round;
        assert.equal(g.cardsPerRound, g.round + (deckMode === 'mono' ? 3 : 0));
        assert.equal(g.dealer, (g.round - 1) % count);
        assert.equal(new Set(g.players.flatMap(p => p.hand.map(c => c.id))).size, count * g.cardsPerRound);
        for (const p of g.players) {
          assert.equal(p.hand.length, g.cardsPerRound);
          assert.ok(p.hand.every(card => (deckMode === 'mono' ? monoDeck(p.monoSuit) : deck()).some(c => c.id === card.id)));
        }
        if (deckMode === 'mono') { assert.equal(g.trump, null); assert.equal(g.reveal, null); }
        else if (g.reveal?.kind === 'number') assert.equal(g.trump, g.reveal.suit);
        else assert.equal(g.trump, null);
        assert.equal(g.turn, g.phase === 'trump' ? g.dealer : (g.dealer + 1) % count);
      }
      if (g.phase === 'trump') act(g, g.players[g.turn].id, { type: 'trump', suit: 'green' }, undefined, 0);
      else if (g.phase === 'bid') {
        const p = options.predictionMode === 'public' ? g.players[g.turn] : g.players.find(p => p.bid === null);
        const v = viewFor(g, p.id);
        const last = g.players.filter(p => p.bid === null).length === 1;
        const expected = Array.from({ length: g.cardsPerRound + 1 }, (_, i) => i).filter(bid =>
          !(options.strict && last && g.players.reduce((sum, p) => sum + (p.bid ?? 0), bid) === g.cardsPerRound));
        assert.deepEqual(v.bids, expected);
        assert.equal(v.foresightActive, options.foresight);
        for (const other of v.players) {
          assert.equal(Array.isArray(other.hand), options.foresight ? other.id !== p.id : other.id === p.id);
          if (options.predictionMode !== 'public' && other.id !== p.id) assert.equal(other.bid, null);
        }
        assert.ok(spectatorView(g).players.every(p => !('hand' in p) && (options.predictionMode === 'public' || p.bid === null)));
        act(g, p.id, { type: 'bid', value: expected[(steps + g.turn) % expected.length] }, undefined, 0);
        if (g.phase === 'play') assert.equal(g.turn, (g.dealer + 1) % count);
      } else if (g.phase === 'play') {
        const p = g.players[g.turn], v = viewFor(g, p.id), expected = expectedLegal(g, p.hand);
        assert.deepEqual(v.legal, expected);
        assert.ok(v.players.filter(other => other.id !== p.id).every(other => !('hand' in other)));
        if (options.predictionMode === 'secret') assert.ok(v.players.filter(other => other.id !== p.id).every(other => other.bid === null));
        const illegal = p.hand.find(card => !expected.includes(card.id));
        if (illegal && !rejected) {
          const before = structuredClone(g);
          assert.throws(() => act(g, p.id, { type: 'play', card: illegal.id }, undefined, 0), /必须跟色/);
          assert.deepEqual(g, before); rejected = true;
        }
        const card = p.hand.find(card => card.id === expected[steps % expected.length]);
        const completed = [...g.trick, { player: g.turn, card }];
        const won = g.players.map(p => p.won), previousTurn = g.turn;
        act(g, p.id, { type: 'play', card: card.id }, undefined, 0);
        if (completed.length === count) {
          const winner = expectedWinner(g, completed);
          assert.equal(g.lastWinner, winner);
          assert.equal(g.players[winner].won, won[winner] + 1);
        } else assert.equal(g.turn, (previousTurn + 1) % count);
      } else {
        if (g.phase === 'roundEnd') assert.equal(g.players.reduce((sum, p) => sum + p.won, 0), g.cardsPerRound);
        const nextLeader = g.lastWinner, nextTrick = g.phase === 'trickEnd';
        act(g, 'p0', { type: 'next' }, undefined, 0);
        if (nextTrick) { assert.equal(g.turn, nextLeader); assert.deepEqual(g.trick, []); }
      }
    }
    assert.equal(g.phase, 'finished', JSON.stringify({ count, options }));
    assert.equal(g.history.length, maxRounds);
    for (const h of g.history) for (const r of h.result) assert.equal(r.delta, r.bid === r.won ? 20 + 10 * r.won : -10 * Math.abs(r.bid - r.won));
    for (const p of g.players) {
      assert.equal(p.hand.length, 0);
      assert.equal(p.score, g.history.reduce((sum, h) => sum + h.result.find(r => r.id === p.id).delta, 0));
      assert.equal(p.matchWins, p.score === Math.max(...g.players.map(p => p.score)) ? 1 : 0);
    }
    cases++;
  }
  assert.equal(cases, deckMode === 'mono' ? 32 : 64);
});
