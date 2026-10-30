import { leadInfo, winnerReason } from './table-summary.js';

const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const signed = value => `${value >= 0 ? '+' : ''}${value}`;

// This is presentation only. The engine and room authority still decide when
// to advance, who may advance, and whether continuation results need approval.
export function settlementHTML(state, { me, isHost = false, practice = false, spectating = false, pending = false } = {}) {
  if (!['trickEnd','roundEnd','finished'].includes(state.phase)) return '';
  const roundEnd = state.phase !== 'trickEnd', finished = state.phase === 'finished';
  const player = state.players.find(p => p.id === me);
  const own = state.history.at(-1)?.round === state.round ? state.history.at(-1).result.find(r => r.id === me) : null;
  const high = Math.max(...state.players.map(p => p.score));
  const winners = state.players.filter(p => p.score === high);
  const title = finished ? `${winners.map(p => escape(p.name)).join('、')}${winners.length > 1 ? ' 并列获胜' : ' 赢得本局'}`
    : roundEnd ? `第 ${state.round} 轮结算` : `${escape(state.players[state.lastWinner]?.name)} 赢得本墩`;
  const personalScore = roundEnd && own ? `<div><b>${own.bid === own.won ? '预测命中' : '预测未中'}</b><strong>${signed(own.delta)} 分</strong></div>` : '';
  const personalStats = roundEnd && own ? `<span class="round-settlement-stats">预测 ${own.bid} · 实赢 ${own.won} · 累计 ${own.total}</span>` : '';
  const personal = personalScore ? `<section class="personal-result" aria-label="你的本轮成绩">${personalScore}${personalStats}</section>` : '';
  const lead = leadInfo(state);
  const hint = !roundEnd && lead ? `下一墩 ${escape(state.players[lead.seat]?.name)} 首攻` : finished ? `最高累计 ${high} 分` : '';
  let action = '';
  const disabled = pending ? 'disabled aria-busy="true"' : '';
  if (state.lifecycle?.closeAfterRound && roundEnd) {
    const confirmed = state.lifecycle.resultsConfirmed?.includes(me);
    action = !spectating && player && !player.bot ? `<button id="confirm-results" class="primary" ${confirmed || pending ? 'disabled' : ''}>${confirmed ? '已确认，等待其他玩家' : pending ? '正在确认…' : '确认结果并离开'}</button>` : '<span class="settlement-wait">等待玩家确认结果</span>';
  } else if (finished) {
    action = isHost && !spectating ? `<button id="rematch" class="primary" ${disabled}>${pending ? '正在提交…' : '再来一局 →'}</button>` : '<span class="settlement-wait">本局结束</span>';
  } else if (roundEnd || practice) {
    const offline = roundEnd && state.players.some(p => !p.online);
    action = isHost && !spectating ? `<button id="next" class="primary" ${offline ? 'disabled' : disabled}>${offline ? '等待玩家重连' : pending ? '正在提交…' : roundEnd ? '开始下一轮 →' : '继续下一墩 →'}</button>` : '<span class="settlement-wait">等待房主继续</span>';
  } else action = '<span id="trick-review-timer" role="timer">看清胜负后继续</span>';
  if (finished && isHost && !spectating) action += '<button id="finished-dissolve" class="danger">解散房间</button>';
  const reason = winnerReason(state.trick, state.trump, state.options.deckMode);
  const finalRound = state.history.at(-1)?.round === state.round ? state.history.at(-1) : null;
  const ranking = [...state.players].sort((a, b) => b.score - a.score);
  const finalResults = finished ? `<section class="final-results" tabindex="0" aria-label="最终分数播报，可滚动" aria-live="polite"><h4>最终分数 · 共 ${state.round} 轮</h4><table><thead><tr><th scope="col">名次</th><th scope="col">玩家</th><th scope="col">末轮预测 / 实赢</th><th scope="col">末轮得分</th><th scope="col">总分</th></tr></thead><tbody>${ranking.map(p => {
    const rank = ranking.findIndex(other => other.score === p.score) + 1;
    const result = finalRound?.result.find(r => r.id === p.id);
    return `<tr class="final-score-row${p.id === me ? ' settlement-self' : ''}" data-player="${escape(p.id)}"><td class="final-rank">${rank}</td><th scope="row" class="final-player">${escape(p.name)}${p.id === me ? ' · 你' : ''}</th><td class="final-bid-won">${result ? `${result.bid} / ${result.won}` : '—'}</td><td class="final-delta">${result ? signed(result.delta) : '—'}</td><td class="final-total">${p.score}</td></tr>`;
  }).join('')}</tbody></table></section>` : '';
  const history = roundEnd ? `<p class="settlement-formula">预测命中：20 + 10 × 实赢；未中：每差 1 墩扣 10 分。</p>${[...state.history].reverse().map(h => `<section class="settlement-history"><h4>第 ${h.round} 轮</h4><table><thead><tr><th scope="col">玩家</th><th scope="col">预测 / 实赢</th><th scope="col">得分</th><th scope="col">累计</th></tr></thead><tbody>${state.players.map(p => {
    const r = h.result.find(r => r.id === p.id);
    return r ? `<tr${p.id === me ? ' class="settlement-self"' : ''}><th scope="row">${escape(p.name)}${p.id === me ? ' · 你' : ''}</th><td>${r.bid} / ${r.won}</td><td>${signed(r.delta)}</td><td>${r.total}</td></tr>` : '';
  }).join('')}</tbody></table></section>`).join('')}` : '';
  const details = `<details class="settlement-details"><summary>查看详情</summary><div class="settlement-details-body" tabindex="0" aria-label="结算详情，可滚动">${reason ? `<p>${escape(reason)}</p>` : ''}${history}</div></details>`;
  if (roundEnd && !finished) {
    return `<section class="action-panel settlement-panel round-settlement" aria-label="本轮结算"><div class="round-settlement-copy"><div class="settlement-summary"><div class="action-title"><h3>${title}</h3></div>${personalScore ? `<section class="personal-result" aria-label="你的本轮成绩">${personalScore}</section>` : ''}</div><div class="round-settlement-meta">${personalStats}${details}</div></div><div class="settlement-actions">${action}</div></section>`;
  }
  return `<section class="action-panel settlement-panel" aria-label="${finished ? '整局结果' : '本墩结算'}">${finalResults}<div class="settlement-summary"><div class="action-title"><h3 title="${title}">${title}</h3>${hint ? `<small>${hint}</small>` : ''}</div>${personal}</div>${details}<div class="settlement-actions">${action}</div></section>`;
}
