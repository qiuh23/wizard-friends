import { icon } from './ui-icons.js';

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
  // Ordinary round/trick results stay on the felt. The public ledger in the
  // menu owns detailed calculations; the authority advances after collection.
  if (!finished && !state.lifecycle?.closeAfterRound) {
    const outcome = own ? `<span class="result-icon">${icon(own.bid === own.won ? 'check' : 'miss')}${own.bid === own.won ? '命中' : '未中'}</span><strong>${signed(own.delta)}</strong>` : '';
    const wait = state.lifecycle?.paused ? '已暂停' : roundEnd && state.players.some(p => !p.online) ? '等待重连' : roundEnd ? '下轮自动发牌' : '下一墩';
    return `<div class="table-result" role="status" aria-label="${roundEnd ? `第 ${state.round} 轮结算${own ? `，预测 ${own.bid}，实赢 ${own.won}，得分 ${signed(own.delta)}，累计 ${own.total}` : ''}` : `${escape(state.players[state.lastWinner]?.name)} 赢得本墩`}">${roundEnd ? outcome : `<span class="result-icon">${icon('trophy')}${escape(state.players[state.lastWinner]?.name)} · 赢墩</span>`}<small${roundEnd ? '' : ' id="trick-review-timer" role="timer"'}>${wait}</small></div>`;
  }
  const title = finished ? `${winners.map(p => escape(p.name)).join('、')}${winners.length > 1 ? ' 并列获胜' : ' 赢得本局'}`
    : roundEnd ? `第 ${state.round} 轮结算` : `${escape(state.players[state.lastWinner]?.name)} 赢得本墩`;
  const finalRound = state.history.at(-1)?.round === state.round ? state.history.at(-1) : null;
  const ranking = [...state.players].sort((a,b)=>b.score-a.score);
  const finalResults = finished ? `<section class="final-results" tabindex="0" aria-label="最终分数播报，可滚动" aria-live="polite"><h4>最终分数 · 共 ${state.round} 轮</h4><table><colgroup><col class="final-col-rank"><col class="final-col-player"><col class="final-col-bid"><col class="final-col-delta"><col class="final-col-total"></colgroup><thead><tr><th scope="col">名次</th><th scope="col">玩家</th><th scope="col" aria-label="末轮预测 / 实赢">预测 / 实赢</th><th scope="col">末轮得分</th><th scope="col">总分</th></tr></thead><tbody>${ranking.map(p=>{
    const rank=ranking.findIndex(other=>other.score===p.score)+1;
    const result=finalRound?.result.find(r=>r.id===p.id);
    return `<tr class="final-score-row${p.id===me?' settlement-self':''}" data-player="${escape(p.id)}"><td class="final-rank">${rank}</td><th scope="row" class="final-player">${escape(p.name)}${p.id===me?' · 你':''}</th><td class="final-bid-won">${result?`${result.bid} / ${result.won}`:'—'}</td><td class="final-delta">${result?signed(result.delta):'—'}</td><td class="final-total">${p.score}</td></tr>`;
  }).join('')}</tbody></table></section>` : '';
  let action='';
  if(state.lifecycle?.closeAfterRound) {
    const confirmed=state.lifecycle.resultsConfirmed?.includes(me);
    action=!spectating&&player&&!player.bot ? `<button id="confirm-results" class="primary" ${confirmed||pending?'disabled':''}>${confirmed?'已确认，等待其他玩家':pending?'正在确认…':'确认结果并离开'}</button>` : '<span class="settlement-wait">等待玩家确认结果</span>';
  } else if(finished) {
    action=isHost&&!spectating ? `<button id="rematch" class="primary" ${pending?'disabled aria-busy="true"':''}>${pending?'正在提交…':'再来一局 →'}</button>` : '<span class="settlement-wait">本局结束</span>';
  } else return `<div class="table-result" role="status">${icon('trophy')}${escape(state.players[state.lastWinner]?.name)} · 赢墩<small id="trick-review-timer" role="timer">下一墩</small></div>`;
  return `<section class="action-panel settlement-panel${finished?'':' round-settlement'}" aria-label="${finished?'整局结果':'本轮结果确认'}">${finalResults}<div class="settlement-summary"><div class="action-title"><h3 title="${title}">${title}</h3></div></div><div class="settlement-actions">${action}</div></section>`;
}
