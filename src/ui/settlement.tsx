import type { RoomModel } from './types';
import { Icon } from './primitives';

const signed = (value: number) => `${value >= 0 ? '+' : ''}${value}`;

/** Presentation consumes the permitted view; the room authority advances play. */
export function Settlement({ model }: { model: RoomModel }) {
  const { state, me, isHost, spectating, pendingSettlement: pending } = model;
  if (!['trickEnd', 'roundEnd', 'finished'].includes(state.phase)) return null;
  const roundEnd = state.phase !== 'trickEnd', finished = state.phase === 'finished';
  const player = state.players.find(p => p.id === me);
  const finalRound = state.history.at(-1)?.round === state.round ? state.history.at(-1) : undefined;
  const own = finalRound?.result.find(r => r.id === me);
  const high = Math.max(...state.players.map(p => p.score));
  const winners = state.players.filter(p => p.score === high);
  const lastWinner = state.players[state.lastWinner]?.name;
  if (!finished && !state.lifecycle?.closeAfterRound) {
    const wait = state.lifecycle?.paused ? '已暂停' : roundEnd && state.players.some(p => !p.online) ? '等待重连' : roundEnd ? '下轮自动发牌' : '下一墩';
    const label = roundEnd ? `第 ${state.round} 轮结算${own ? `，预测 ${own.bid}，实赢 ${own.won}，得分 ${signed(own.delta)}，累计 ${own.total}` : ''}` : `${lastWinner} 赢得本墩`;
    return <div className="table-result" role="status" aria-label={label}>
      {roundEnd ? own && <><span className="result-icon"><Icon name={own.bid === own.won ? 'check' : 'miss'} />{own.bid === own.won ? '命中' : '未中'}</span><strong>{signed(own.delta)}</strong></> : <span className="result-icon"><Icon name="trophy" />{lastWinner} · 赢墩</span>}
      <small id={roundEnd ? undefined : 'trick-review-timer'} role={roundEnd ? undefined : 'timer'}>{wait}</small>
    </div>;
  }
  const title = finished ? `${winners.map(p => p.name).join('、')}${winners.length > 1 ? ' 并列获胜' : ' 赢得本局'}` : roundEnd ? `第 ${state.round} 轮结算` : `${lastWinner} 赢得本墩`;
  const ranking = [...state.players].sort((a, b) => b.score - a.score);
  const confirmed = state.lifecycle?.resultsConfirmed?.includes(me);
  return <section className={`action-panel settlement-panel${finished ? '' : ' round-settlement'}`} aria-label={finished ? '整局结果' : '本轮结果确认'}>
    {finished && <section className="final-results" tabIndex={0} aria-label="最终分数播报，可滚动" aria-live="polite"><h4>最终分数 · 共 {state.round} 轮</h4><table>
      <colgroup><col className="final-col-rank" /><col className="final-col-player" /><col className="final-col-bid" /><col className="final-col-delta" /><col className="final-col-total" /></colgroup>
      <thead><tr><th scope="col">名次</th><th scope="col">玩家</th><th scope="col" aria-label="末轮预测 / 实赢">预测 / 实赢</th><th scope="col">末轮得分</th><th scope="col">总分</th></tr></thead>
      <tbody>{ranking.map(p => {
        const result = finalRound?.result.find(r => r.id === p.id);
        return <tr key={p.id} className={`final-score-row${p.id === me ? ' settlement-self' : ''}`} data-player={p.id}>
          <td className="final-rank">{ranking.findIndex(other => other.score === p.score) + 1}</td><th scope="row" className="final-player">{p.name}{p.id === me ? ' · 你' : ''}</th>
          <td className="final-bid-won">{result ? `${result.bid} / ${result.won}` : '—'}</td><td className="final-delta">{result ? signed(result.delta) : '—'}</td><td className="final-total">{p.score}</td>
        </tr>;
      })}</tbody>
    </table></section>}
    <div className="settlement-summary"><div className="action-title"><h3 title={title}>{title}</h3></div></div>
    <div className="settlement-actions">{state.lifecycle?.closeAfterRound
      ? !spectating && player && !player.bot ? <button id="confirm-results" className="primary" disabled={!!confirmed || pending}>{confirmed ? '已确认，等待其他玩家' : pending ? '正在确认…' : '确认结果并离开'}</button> : <span className="settlement-wait">等待玩家确认结果</span>
      : isHost && !spectating ? <button id="rematch" className="primary" disabled={pending} aria-busy={pending}>{pending ? '正在提交…' : '再来一局 →'}</button> : <span className="settlement-wait">本局结束</span>}
    </div>
  </section>;
}
