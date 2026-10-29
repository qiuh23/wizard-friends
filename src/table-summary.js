import { winner, SUIT_NAMES } from './game.js';

const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const signed = value => `${value >= 0 ? '+' : ''}${value}`;

export function leadInfo(state) {
  const count = state.players.length, first = (state.dealer + 1) % count;
  if (state.phase === 'finished') return null;
  if (state.phase === 'roundEnd') return { seat: (first + 1) % count, label: '下轮首攻' };
  if (state.phase === 'trickEnd') return { seat: state.lastWinner, label: '下墩先手' };
  if (['trump', 'bid'].includes(state.phase)) return { seat: first, label: '首墩先手' };
  return { seat: state.trick[0]?.player ?? state.turn, label: '本墩首攻' };
}
export function playerTotals(state, id) {
  const settled = state.history.flatMap(h => h.result.filter(r => r.id === id));
  const player = state.players.find(p => p.id === id);
  const currentSettled = state.history.some(h => h.round === state.round);
  return {
    tricks: settled.reduce((sum, r) => sum + r.won, 0) + (currentSettled ? 0 : player?.won ?? 0),
    exactRounds: settled.filter(r => r.bid === r.won).length,
    matchWins: player?.matchWins ?? 0,
  };
}
export function winnerReason(trick, trump, deckMode = 'standard') {
  if (!trick.length) return '';
  const winning = trick.find(play => play.player === winner(trick, trump, deckMode)).card;
  if (winning.kind === 'wizard') return '最先打出的巫师获胜，后出的巫师不能超过它。';
  if (winning.kind === 'jester') return '本墩全是小丑，最先出的小丑获胜。';
  if (deckMode === 'mono') {
    const tied = trick.filter(play => play.card.kind === 'number' && play.card.rank === winning.rank).length > 1;
    return `单色牌库比较数字，最大点数 ${winning.rank} 获胜${tied ? '；同点数时先出者胜' : ''}。`;
  }
  const suit = SUIT_NAMES[winning.suit].split(' · ')[0];
  return winning.suit === trump ? `本墩没有巫师，最大的${suit}色主牌 ${winning.rank} 获胜。` : `本墩没有巫师或主牌，首攻${suit}色中最大的 ${winning.rank} 获胜。`;
}
export function scoreHistoryHTML(state, me) {
  const rows = state.history.map(h => ({ ...h, settled: true }));
  if (state.round && !rows.some(h => h.round === state.round)) rows.push({ round: state.round, settled: false, result: state.players.map(p => ({ id: p.id, bid: p.bid, won: p.won, total: p.score, bidSubmitted: p.bidSubmitted })) });
  return `<section class="score-ledger" aria-labelledby="ledger-title"><h3 id="ledger-title">逐轮计分表</h3><p class="ledger-hint">每轮预测 / 实赢以墩计；得分按预测偏差计算。横向滑动查看所有玩家。</p><div class="history-scroll" tabindex="0" aria-label="逐轮计分表，可横向滚动"><table><caption class="sr-only">每轮每人的预测墩数、实际赢墩、轮次得分和累计分</caption><thead><tr><th scope="col">轮次</th>${state.players.map(p => `<th scope="col" class="${p.id === me ? 'ledger-self' : ''}">${escape(p.name)}${p.id === me ? ' · 你' : ''}</th>`).join('')}</tr></thead><tbody>${rows.map(h => `<tr class="${h.settled ? '' : 'in-progress'}"><th scope="row">第 ${h.round} 轮${h.settled ? '' : '<small>进行中</small>'}</th>${state.players.map(p => {
    const r = h.result.find(row => row.id === p.id);
    if (!r) return '<td>—</td>';
    return `<td class="${p.id === me ? 'ledger-self' : ''}"><div class="ledger-cell"><span>预测 <b>${r.bid ?? (r.bidSubmitted ? '未公开' : '—')}</b></span><span>实赢 <b>${r.won}</b></span><span>得分 <b class="${h.settled ? r.delta >= 0 ? 'positive' : 'negative' : ''}">${h.settled ? signed(r.delta) : '待结算'}</b></span><span>累计 <b>${r.total}</b></span></div></td>`;
  }).join('')}</tr>`).join('') || `<tr><td colspan="${state.players.length + 1}">开始游戏后记录每轮成绩</td></tr>`}</tbody></table></div></section>`;
}
