import type { RoomModel } from './types';
import { Icon } from './primitives';
import { playerTotals } from '../table-summary.js';

const signed = (value: number) => `${value >= 0 ? '+' : ''}${value}`;

function ScoreHistory({ model }: { model: RoomModel }) {
  const { state, me } = model;
  const rows = state.history.map(h => ({ ...h, settled: true }));
  if (state.round && !rows.some(h => h.round === state.round)) rows.push({ round: state.round, settled: false, result: state.players.map(p => ({ id: p.id, bid: p.bid, won: p.won, total: p.score, bidSubmitted: p.bidSubmitted, delta: 0 })) });
  return <section className="score-ledger" aria-labelledby="ledger-title"><h3 id="ledger-title">逐轮计分表</h3><p className="ledger-hint">每轮预测 / 实赢以墩计；得分按预测偏差计算。横向滑动查看所有玩家。</p><div className="history-scroll" tabIndex={0} aria-label="逐轮计分表，可横向滚动"><table>
    <caption className="sr-only">每轮每人的预测墩数、实际赢墩、轮次得分和累计分</caption>
    <thead><tr><th scope="col">轮次</th>{state.players.map(p => <th key={p.id} scope="col" className={p.id === me ? 'ledger-self' : ''}>{p.name}{p.id === me ? ' · 你' : ''}</th>)}</tr></thead>
    <tbody>{rows.length ? rows.map(h => <tr key={h.round} className={h.settled ? '' : 'in-progress'}><th scope="row">第 {h.round} 轮{!h.settled && <small>进行中</small>}</th>{state.players.map(p => {
      const r = h.result.find(row => row.id === p.id);
      return r ? <td key={p.id} className={p.id === me ? 'ledger-self' : ''}><div className="ledger-cell"><span>预测 <b>{r.bid ?? (r.bidSubmitted ? '未公开' : '—')}</b></span><span>实赢 <b>{r.won}</b></span><span>得分 <b className={h.settled ? r.delta >= 0 ? 'positive' : 'negative' : ''}>{h.settled ? signed(r.delta) : '待结算'}</b></span><span>累计 <b>{r.total}</b></span></div></td> : <td key={p.id}>—</td>;
    })}</tr>) : <tr><td colSpan={state.players.length + 1}>开始游戏后记录每轮成绩</td></tr>}</tbody>
  </table></div></section>;
}

export function Scores({ model }: { model: RoomModel }) {
  const { state, me, scoresOpen } = model;
  const roundEnd = ['roundEnd', 'finished'].includes(state.phase);
  return <aside id="table-score-panel" aria-label="计分表与玩家信息" hidden={!scoresOpen}>
    <button className="close-scores table-icon-button" aria-label="关闭计分表" title="关闭计分表"><Icon name="close" /><span className="control-label">关闭</span></button>
    <ScoreHistory model={model} />
    <section className="panel scoreboard"><div className="section-label">预言排行榜 <span>总分</span></div>
      {[...state.players].sort((a, b) => b.score - a.score).map((p, i) => {
        const totals = playerTotals(state, p.id);
        return <div key={p.id} className="score-row"><span className="rank">{String(i + 1).padStart(2, '0')}</span><span>{p.name}{p.id === me && <small>你</small>}<small>胜局 {totals.matchWins} · 本局赢 {totals.tricks} 墩 · 猜中 {totals.exactRounds} 轮</small></span><b>{p.score}</b></div>;
      })}
      {roundEnd && <div className="round-results"><h4>第 {state.round} 轮得分</h4>{state.history.at(-1)?.result.map(r => <div key={r.id}><span>{state.players.find(p => p.id === r.id)?.name} <small>{r.won}/{r.bid} 墩</small></span><b className={r.delta > 0 ? 'positive' : 'negative'}>{r.delta > 0 ? '+' : ''}{r.delta}</b></div>)}</div>}
    </section>
    <details className="journal-details"><summary>对局记录</summary><section className="panel journal"><div className="section-label">牌桌记事 <span>↙</span></div>{state.log.slice(-7).map((line, i) => <p key={i}>{line}</p>)}</section></details>
  </aside>;
}
