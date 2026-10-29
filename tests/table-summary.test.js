import test from 'node:test';
import assert from 'node:assert/strict';
import { leadInfo, playerTotals, winnerReason, scoreHistoryHTML } from '../src/table-summary.js';
import { createGame, addPlayer, viewFor, spectatorView } from '../src/game.js';

const n = (suit, rank) => ({ kind: 'number', suit, rank });
const trick = (...cards) => cards.map((card, player) => ({ player, card }));
test('first leader stays distinct from current bidder/player, then follows trick winner or next dealer', () => {
  const g = createGame(); for (let i = 0; i < 6; i++) addPlayer(g, `p${i}`, `玩家${i}`);
  Object.assign(g, { dealer: 5, turn: 2, phase: 'bid' });
  assert.deepEqual(leadInfo(g), { seat: 0, label: '首墩先手' });
  g.phase = 'play'; g.trick = [{ player: 4, card: n('red', 2) }];
  assert.deepEqual(leadInfo(g), { seat: 4, label: '本墩首攻' });
  g.phase = 'trickEnd'; g.lastWinner = 3;
  assert.deepEqual(leadInfo(g), { seat: 3, label: '下墩先手' });
  g.phase = 'roundEnd'; assert.deepEqual(leadInfo(g), { seat: 1, label: '下轮首攻' });
  g.phase = 'finished'; assert.equal(leadInfo(g), null);
});
test('winning explanations cover first wizard, all jesters, trump, lead color and mono equal numbers', () => {
  assert.match(winnerReason(trick({ kind: 'wizard' }, { kind: 'wizard' }), 'red'), /最先.*巫师/);
  assert.match(winnerReason(trick({ kind: 'jester' }, { kind: 'jester' }), null), /全是小丑/);
  assert.match(winnerReason(trick(n('blue', 13), n('red', 1)), 'red'), /红色主牌 1/);
  assert.match(winnerReason(trick({ kind: 'jester' }, n('blue', 4), n('red', 13)), null), /首攻蓝色.*4/);
  assert.match(winnerReason(trick(n('blue', 13), n('red', 13)), null, 'mono'), /13.*同点数.*先出/);
});
test('totals do not count the settled current round twice; ledger maps identities and preserves secret predictions', () => {
  const g = createGame(); for (let i = 0; i < 3; i++) addPlayer(g, `p${i}`, i ? `玩家${i}` : '<玩家>');
  Object.assign(g, { phase: 'play', round: 2, cardsPerRound: 2 });
  g.options.predictionMode = 'secret';
  g.history = [{ round: 1, result: [{ id: 'p1', bid: 1, won: 1, delta: 30, total: 30 }, { id: 'p0', bid: 0, won: 0, delta: 20, total: 20 }] }];
  Object.assign(g.players[1], { bid: 2, won: 1, score: 30, matchWins: 3 });
  const visible = viewFor(g, 'p0'), html = scoreHistoryHTML(visible, 'p0');
  assert.deepEqual(playerTotals(visible, 'p1'), { tricks: 2, exactRounds: 1, matchWins: 3 });
  assert.match(html, /&lt;玩家&gt;/); assert.match(html, /预测 <b>未公开/);
  assert.match(html, /实赢 <b>1/); assert.match(html, /得分 <b class="positive">\+30/);
  assert.match(html, /累计 <b>30/); assert.match(html, /进行中/);
  assert.match(scoreHistoryHTML(spectatorView(g), ''), /预测 <b>未公开/);
  g.phase = 'roundEnd'; g.history.push({ round: 2, result: [{ id: 'p1', bid: 2, won: 1, delta: -10, total: 20 }] });
  assert.deepEqual(playerTotals(viewFor(g, 'p0'), 'p1'), { tricks: 2, exactRounds: 1, matchWins: 3 });
});
