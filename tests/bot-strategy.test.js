import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, addPlayer, act, botAction, legalCards, viewFor } from '../src/game.js';

const number = (suit, rank) => ({ id: `${suit}-${rank}`, kind: 'number', suit, rank });
const wizard = id => ({ id: `wizard-${id}`, kind: 'wizard' });
const jester = id => ({ id: `jester-${id}`, kind: 'jester' });
const trick = (...cards) => cards.map((card, player) => ({ player, card }));
function playing(hand, bid, won = 0, options = {}) {
  const g = createGame();
  for (let i = 0; i < 3; i++) addPlayer(g, `p${i}`, `玩家${i}`, true);
  Object.assign(g, { phase: 'play', round: hand.length + won, cardsPerRound: hand.length + won,
    completedTricks: won, turn: 2, trick: trick(number('blue', 7), number('blue', 8)) });
  Object.assign(g.options, options);
  Object.assign(g.players[2], { hand, bid, won });
  return g;
}
const play = g => botAction(g, 'p2', 'smart');

test('take an available trick when all remaining tricks are needed, then duck at or above target', () => {
  const g = playing([number('blue', 3), number('blue', 13)], 2);
  assert.equal(play(g).card, 'blue-13');
  for (const won of [1, 2]) {
    Object.assign(g.players[2], { bid: 1, won });
    assert.equal(play(g).card, 'blue-3');
  }
  Object.assign(g.players[2], { bid: 0, won: 0 });
  assert.equal(play(g).card, 'blue-3');
});

test('reserve a guaranteed future winner when weaker current play improves the round score', () => {
  const g = playing([number('blue', 3), wizard(0)], 1);
  assert.equal(play(g).card, 'blue-3');
  // Without a guaranteed future winner, take the exact available win now.
  g.players[2].hand = [number('blue', 3), number('blue', 13)];
  assert.equal(play(g).card, 'blue-13');
});

test('win with the cheaper sufficient card and keep the wizard for a later required trick', () => {
  const g = playing([number('blue', 9), wizard(0), jester(0)], 2);
  assert.equal(play(g).card, 'blue-9');
});

test('shed dangerous strength safely on a lost trick, including a later wizard', () => {
  const g = playing([number('red', 13), jester(0)], 0);
  assert.equal(play(g).card, 'red-13');
  g.players[2].hand = [wizard(0), jester(0)];
  g.trick = trick(wizard(1), number('blue', 8));
  assert.equal(play(g).card, 'wizard-0');
});

test('several consecutive post-target opportunities avoid extra wins and retain the exact score', () => {
  const g = playing([number('blue', 3), number('blue', 4), number('blue', 13), wizard(0)], 1, 1);
  const leads = [
    trick(number('blue', 10), number('blue', 12)),
    trick(number('red', 10), number('red', 12)),
    trick(number('green', 10), number('green', 12)),
    trick(wizard(1), number('yellow', 12)),
  ];
  for (const cards of leads) {
    Object.assign(g, { phase: 'play', turn: 2, trick: cards, turnDeadline: null });
    const action = play(g);
    assert.ok(legalCards(g.players[2].hand, g.trick).some(card => card.id === action.card));
    act(g, 'p2', action, undefined, 0);
    assert.equal(g.players[2].won, 1);
  }
  assert.equal(g.players[2].hand.length, 0);
  assert.equal(g.history.at(-1).result.find(result => result.id === 'p2').delta, 30);
});

test('an unreachable target still reduces the absolute-error penalty', () => {
  const g = playing([number('blue', 3), number('blue', 13)], 5);
  g.cardsPerRound = g.round = 5;
  g.completedTricks = 3;
  assert.equal(play(g).card, 'blue-13');
});

test('forced follow suit, all-jester prefixes and first-wizard priority remain legal', () => {
  const g = playing([number('blue', 3), number('red', 13)], 2);
  assert.deepEqual(play(g), { type: 'play', card: 'blue-3' });
  g.players[2].hand = [jester(0), wizard(0)];
  g.players[2].bid = 0;
  g.trick = trick(jester(1), jester(2));
  assert.equal(play(g).card, 'jester-0');
  g.players[2].bid = 2;
  assert.equal(play(g).card, 'wizard-0');
  g.trick = trick(wizard(1), jester(2));
  for (const bid of [0, 2]) {
    g.players[2].bid = bid;
    const action = play(g);
    assert.ok(viewFor(g, 'p2').legal.includes(action.card));
    act(g, 'p2', action, undefined, 0);
    assert.equal(g.lastWinner, 0);
    if (bid === 0) Object.assign(g, { phase: 'play', turn: 2, trick: trick(wizard(1), jester(2)) });
  }
});

test('mono equal ranks lose to the earlier card and special cards still respect the target', () => {
  const g = playing([number('green', 10), number('green', 13)], 0, 0, { deckMode: 'mono' });
  for (const [i, suit] of ['blue', 'red', 'green'].entries()) g.players[i].monoSuit = suit;
  g.trick = trick(number('blue', 10), number('red', 9));
  assert.equal(play(g).card, 'green-10');
  g.players[2].bid = 2;
  assert.equal(play(g).card, 'green-13');
  g.players[2].hand = [wizard('green'), jester('green')];
  g.players[2].bid = 0;
  g.trick = trick(wizard('blue'), number('red', 13));
  assert.equal(play(g).card, 'wizard-green');
});

test('play planning is deterministic after JSON restore and never changes authority state or random stream', () => {
  const g = playing([number('blue', 3), number('blue', 13), wizard(0), jester(0)], 1, 1,
    { predictionMode: 'secret' });
  const before = structuredClone(g), action = play(g);
  for (let i = 0; i < 5; i++) assert.deepEqual(play(g), action);
  assert.deepEqual(g, before);
  assert.deepEqual(play(JSON.parse(JSON.stringify(g))), action);
  // Keep public counts unchanged while replacing every hidden opponent value.
  for (const player of g.players.slice(0, 2)) {
    player.hand = [wizard(2), wizard(3)];
    player.bid = 999;
  }
  const withSecrets = play(g);
  for (const player of g.players.slice(0, 2)) {
    player.hand = [number('red', 1), number('yellow', 1)];
    player.bid = -999;
  }
  assert.deepEqual(play(g), withSecrets);
});

test('a single forced last card, an empty legal hand and an inactive or offline bot are bounded', () => {
  const g = playing([jester(0)], 0);
  assert.deepEqual(play(g), { type: 'play', card: 'jester-0' });
  g.players[2].hand = [];
  assert.equal(play(g), null);
  g.players[2].hand = [wizard(0)];
  g.turn = 1;
  assert.equal(play(g), null);
  g.turn = 2;
  g.players[2].online = false;
  assert.equal(play(g), null);
});
