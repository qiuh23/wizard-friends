import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, addPlayer, act, viewFor, spectatorView, botAction, normalizeGame } from '../src/game.js';
import { DEFAULT_OPTIONS } from '../src/rules-options.js';

function room(count = 3) {
  const g = createGame();
  for (let i = 0; i < count; i++) addPlayer(g, `p${i}`, `玩家${i}`, i > 0);
  return g;
}
function finishRound(g) {
  for (let step = 0; step < 1000 && !['roundEnd', 'finished'].includes(g.phase); step++) {
    if (g.phase === 'trickEnd') act(g, 'p0', { type: 'next' });
    else {
      const p = g.players.find(p => viewFor(g, p.id).canBid) ?? g.players[g.turn];
      const bot = p.bot; p.bot = true;
      const action = botAction(g, p.id); p.bot = bot;
      assert.ok(action); act(g, p.id, action);
    }
  }
  assert.ok(['roundEnd', 'finished'].includes(g.phase));
}
test('host chooses public whole-game options before dealing; guests cannot change or start them', () => {
  const g = room(), options = { ...DEFAULT_OPTIONS, predictionMode: 'secret', short: true, strict: true };
  const before = structuredClone(g);
  for (const actor of ['p1', 'outsider']) for (const type of ['configure', 'start']) {
    assert.throws(() => act(g, actor, { type, options }));
    assert.deepEqual(g, before);
  }
  act(g, 'p0', { type: 'configure', options });
  assert.equal(g.phase, 'lobby'); assert.equal(g.round, 0);
  assert.ok(g.players.every(p => !p.hand.length));
  assert.deepEqual(viewFor(g, 'p1').options, { ...options, strict: false });
  assert.deepEqual(spectatorView(g).options, g.options);
  act(g, 'p0', { type: 'start' });
  assert.equal(g.round, 1); assert.equal(g.maxRounds, 5);
  assert.equal(g.vote, undefined);
});
test('invalid options and missing/offline players cannot partially mutate a game or deal', () => {
  const g = room(), before = structuredClone(g);
  for (const options of [null, [], {}, { ...DEFAULT_OPTIONS, strict: 1 }, { ...DEFAULT_OPTIONS, deckMode: 'invalid' }, { ...DEFAULT_OPTIONS, seed: 'private' }]) {
    for (const type of ['configure', 'start']) {
      assert.throws(() => act(g, 'p0', { type, options }));
      assert.deepEqual(g, before);
    }
  }
  g.players[2].online = false;
  assert.throws(() => act(g, 'p0', { type: 'start' }));
  assert.equal(g.round, 0);
  assert.throws(() => act(room(2), 'p0', { type: 'start' }));
  const five = room(5);
  assert.throws(() => act(five, 'p0', { type: 'start', options: { ...DEFAULT_OPTIONS, deckMode: 'mono' } }), /3–4/);
  assert.equal(five.phase, 'lobby'); assert.equal(five.options.deckMode, 'standard');
});
for (const deckMode of ['standard', 'mono']) test(`${deckMode} next round preserves every option, history and suits and rotates the first leader`, () => {
  const g = room(), options = { ...DEFAULT_OPTIONS, deckMode, short: true, predictionMode: 'secret', foresight: true };
  act(g, 'p0', { type: 'start', options });
  const suits = g.players.map(p => p.monoSuit);
  finishRound(g);
  const history = structuredClone(g.history), scores = g.players.map(p => p.score);
  g.players[1].online = false;
  const offline = structuredClone(g);
  assert.throws(() => act(g, 'p0', { type: 'next' }), /重连/);
  assert.deepEqual(g, offline);
  g.players[1].online = true;
  assert.throws(() => act(g, 'p0', { type: 'configure', options: DEFAULT_OPTIONS }), /开始前/);
  assert.throws(() => act(g, 'p0', { type: 'beginVote' }));
  assert.throws(() => act(g, 'p1', { type: 'vote', choices: DEFAULT_OPTIONS }));
  act(g, 'p0', { type: 'next', options: DEFAULT_OPTIONS });
  assert.equal(g.round, 2); assert.equal(g.dealer, 1);
  assert.deepEqual(g.options, options); assert.deepEqual(g.history, history);
  assert.deepEqual(g.players.map(p => p.score), scores);
  assert.deepEqual(g.players.map(p => p.monoSuit), suits);
  assert.equal(g.turn, g.phase === 'trump' ? 1 : 2);
  assert.equal(viewFor(g, 'p0').foresightActive, true);
});
test('legacy ballots return to lobby or settled results without re-dealing; in-progress hands and scores survive', () => {
  for (const round of [0, 2]) {
    const g = room(); g.rulesVersion = 2; g.phase = 'rules'; g.round = round;
    g.options.predictionMode = 'secret'; g.players[0].score = 40;
    g.history = round ? [{ round: 2, result: [{ id: 'p0', bid: 1, won: 1, delta: 30, total: 40 }] }] : [];
    g.vote = { resolved: { foresight: true }, ballots: { p1: { predictionMode: 'hidden' } } };
    const history = structuredClone(g.history), random = structuredClone(g.randomState);
    normalizeGame(g);
    assert.equal(g.phase, round ? 'roundEnd' : 'lobby'); assert.equal(g.vote, undefined);
    assert.equal(g.options.predictionMode, 'secret');
    assert.equal(g.options.foresight, !round);
    assert.deepEqual(g.history, history); assert.deepEqual(g.randomState, random);
    assert.equal(g.players[0].score, 40); assert.equal(g.rulesVersion, 3);
  }
  const g = room(); act(g, 'p0', { type: 'start' }); g.rulesVersion = 2;
  const before = structuredClone(g); normalizeGame(g);
  assert.deepEqual(g.players, before.players); assert.equal(g.phase, before.phase);
});
test('a completed game awards tied match wins once and rematch retains them and chosen options', () => {
  const g = room();
  Object.assign(g, { phase: 'play', round: 1, cardsPerRound: 1, maxRounds: 1, completedTricks: 0 });
  g.options.short = true;
  for (let i = 0; i < 3; i++) Object.assign(g.players[i], { hand: [{ id: `blue-${i + 1}`, kind: 'number', suit: 'blue', rank: i + 1 }], bid: 0, score: i === 2 ? 30 : 0 });
  for (let i = 0; i < 3; i++) act(g, `p${i}`, { type: 'play', card: `blue-${i + 1}` });
  assert.equal(g.phase, 'finished'); assert.deepEqual(g.players.map(p => p.matchWins), [1, 1, 1]);
  act(g, 'p0', { type: 'chat', text: '再来' }); normalizeGame(g);
  assert.deepEqual(g.players.map(p => p.matchWins), [1, 1, 1]);
  act(g, 'p0', { type: 'rematch' });
  assert.equal(g.phase, 'lobby'); assert.deepEqual(g.players.map(p => p.matchWins), [1, 1, 1]);
  assert.ok(g.players.every(p => p.score === 0)); assert.equal(g.options.short, true);
});
