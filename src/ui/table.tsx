import type { CSSProperties, ReactNode } from 'react';
import type { RoomModel, CardView, PlayerView, Suit } from './types';
import { Card, Icon, IconButton } from './primitives';
import { SUITS, SUIT_NAMES, winner } from '../game.js';
import { leadInfo } from '../table-summary.js';
import { bidStatus, bidPrompt } from '../bid-status.js';
import { avatarCharacter } from '../graphemes.js';
import { seatPosition, relativeSeat, followSuitHint, playBlockedReason, sortCards } from '../hand-model.js';
import { shortSeatName } from '../table-layout.js';
import { CARD_ENTER_MS } from '../table-motion.js';
import { Scores } from './scores';
import { Settlement } from './settlement';

const avatarColors = ['#94d6cb', '#eeb9a4', '#a9caff', '#f1d37b', '#c9b4ec', '#b9d59a'];
const cardLabel = (card: CardView) => card.kind === 'wizard' ? '巫师 W' : card.kind === 'jester' ? '小丑 J' : `${SUIT_NAMES[card.suit!].split(' · ')[0]} ${card.rank}`;

function SeatDetails({ model, player, index, lead, children }: { model: RoomModel; player: PlayerView; index: number; lead?: { label: string } | null; children: ReactNode }) {
  const prediction = bidStatus(model.state, player.id, { connected: model.practice || model.networkReady });
  const detail = `${player.name}${player.id === model.me ? ' · 你' : ''}${lead ? ` · ${lead.label}` : ''}${prediction === 'submitted' ? ' · 已预测' : prediction ? ' · 等待预测' : ''}`;
  return <button type="button" className="seat-details" data-player-details={player.id} aria-controls="table-score-panel" aria-expanded={model.scoresOpen && model.scoreSource === player.id} aria-label={`查看 ${detail} 的信息`} title={detail}>
    <span className="avatar" data-bid-state={prediction} style={{ '--avatar-color': avatarColors[index % avatarColors.length] } as CSSProperties} aria-hidden="true"><span className="avatar-glyph">{avatarCharacter(player.name)}</span><small className="avatar-seat">{index + 1}</small>{lead && <span className="lead-badge" aria-hidden="true">先</span>}{prediction && <span className="bid-state-mark" aria-hidden="true">{prediction === 'submitted' ? '✓' : '…'}</span>}</span>{children}
  </button>;
}

function OwnStatus({ model, player }: { model: RoomModel; player?: PlayerView }) {
  if (!player) return null;
  const { state, me, practice, networkReady } = model;
  const lead = leadInfo(state), index = state.players.findIndex(p => p.id === player.id);
  const ownTurn = state.players[state.turn]?.id === me;
  const disconnected = !practice && !networkReady;
  const selected = player.hand?.find(card => card.id === model.selectedCard);
  const reason = model.pendingPlay ? '正在提交，等待房间确认' : selected ? disconnected ? '连接恢复中，重新连接后再选择' : playBlockedReason(state, me, selected) : '';
  const actionIcon = disconnected ? 'reconnect' : state.lifecycle?.paused ? 'pause' : state.lifecycle?.reconnecting ? 'reconnect' : ownTurn ? 'play' : 'clock';
  const actionText = disconnected ? '重连中' : state.lifecycle?.paused ? '已暂停' : state.lifecycle?.reconnecting ? '等待重连' : ownTurn ? '你出牌' : `等 ${shortSeatName(state.players[state.turn]?.name, relativeSeat(state.turn, index, state.players.length))}`;
  return <section className={`own-status ${(state.phase === 'bid' ? state.canBid : ['play', 'trump'].includes(state.phase) && ownTurn) ? 'active' : ''}`} aria-label="你的本轮预测和成绩">
    <SeatDetails model={model} player={player} index={index} lead={lead?.seat === index ? lead : null}><span className="own-name" title={player.name}>{player.name}<small>你</small></span></SeatDetails><div className="own-metrics"><span aria-label={`实赢 ${player.won} 墩`}><Icon name="trophy" /><small>赢</small><b>{player.won}</b></span><span aria-label={`预测 ${player.bid ?? '未提交'} 墩`}><Icon name="target" /><small>估</small><b>{player.bid ?? '—'}</b></span></div>
    {state.phase === 'play' && <div className="own-action"><span><b><Icon name={actionIcon} />{actionText}</b><small className="follow-requirement">{ownTurn ? followSuitHint(state, me) : ''}</small><small className="play-block-reason" role="status" aria-live="polite" hidden={!reason}>{reason}</small></span><span id="turn-countdown" role="timer" /></div>}
  </section>;
}

function Hand({ model, player, myTurn }: { model: RoomModel; player?: PlayerView; myTurn: boolean }) {
  const { state, me, handExpanded, handCollapsed, handSort, selectedCard, pendingPlay, networkReady, practice } = model;
  if (state.foresightActive) return <section className="concealed-hand" aria-label="你的手牌" role="status">手牌暂时保密，全员预测后揭晓</section>;
  const cards: CardView[] = sortCards(player?.hand || [], handSort);
  const selected = cards.find(card => card.id === selectedCard);
  const hovered = cards.find(card => card.id === model.hoveredCard && card.id !== selectedCard);
  const reason = pendingPlay ? '正在提交，等待房间确认' : selected ? !networkReady && !practice ? '连接恢复中，重新连接后再选择' : playBlockedReason(state, me, selected) : '';
  return <>
    <div className="hover-preview" hidden={!hovered} aria-live="polite">{hovered && <><Card card={hovered} /><span>查看 {cardLabel(hovered)}</span><small>点击选中，再确认出牌</small></>}</div>
    <div className="selected-preview" aria-live="polite" hidden={!selected || !!hovered}>{selected && <><Card card={selected} /><span>已选 {cardLabel(selected)}</span>{reason && <small>{reason}</small>}</>}</div>
    <section className={`hand-section ${handExpanded ? 'expanded' : ''} ${handCollapsed ? 'collapsed' : ''}`} aria-label="你的手牌">
      <div className={`hand ${handExpanded ? 'hand-grid' : 'hand-strip'}`} tabIndex={0}>{cards.length ? cards.map(card => <Card key={card.id} card={card} inspectable legal={myTurn && state.legal.includes(card.id!)} selected={card.id === selectedCard} />) : <p className="muted" aria-label="本轮手牌已出完" />}</div>
      {state.phase === 'play' && myTurn && !state.lifecycle?.paused && !state.lifecycle?.continuationVote && (practice || networkReady) && <div className="play-confirm" data-submitting={String(pendingPlay)} aria-busy={pendingPlay}><button id="confirm-play" className="primary" aria-label={pendingPlay ? '正在提交出牌' : selected ? `确认打出 ${cardLabel(selected)}${reason ? `，${reason}` : ''}` : '请先选择手牌后确认出牌'} disabled={!selected || !!reason} title={reason || (selected ? `打出 ${cardLabel(selected)}` : '请先选择手牌')}>{pendingPlay ? '正在提交…' : '出牌'}</button></div>}
    </section>
  </>;
}

/** Sibling of the table, matching the established floating tool placement. */
export function HandTools({ model }: { model: RoomModel }) {
  const { state, me, handCollapsed, handExpanded, handSort, spectating } = model;
  if (spectating || state.foresightActive) return null;
  const player = state.players.find(p => p.id === me);
  return <div className="hand-tools" aria-label="手牌工具"><span className="hand-count" aria-label={`手牌 ${player?.count ?? player?.hand?.length ?? 0} 张`}><Icon name="cards" />{player?.count ?? player?.hand?.length ?? 0}</span>
    <IconButton id="hand-collapse" name={handCollapsed ? 'up' : 'down'} label={handCollapsed ? '显示手牌' : '收起手牌'} aria-expanded={!handCollapsed}>{handCollapsed ? '手牌' : '收起'}</IconButton>
    <IconButton id="hand-sort" name="sort" label={`手牌按${handSort === 'suit' ? '花色' : '点数'}排序，切换为${handSort === 'suit' ? '点数' : '花色'}排序`}>{handSort === 'suit' ? '花色' : '点数'}</IconButton>
    <IconButton id="hand-expand" name={handExpanded ? 'fan' : 'expand'} label={handExpanded ? '收起展开手牌' : '展开全部手牌'} aria-expanded={handExpanded}>{handExpanded ? '扇形' : '展开'}</IconButton>
  </div>;
}

function Foresight({ model }: { model: RoomModel }) {
  const { state, me, spectating, foresightSort, handSort } = model;
  if (!state.foresightActive || spectating) return null;
  return <section id="foresight-hands" className="foresight-hands" tabIndex={0} aria-label="先见之明：其他玩家手牌，可上下滚动"><header className="foresight-heading"><b>其他玩家手牌</b><button id="foresight-sort" type="button" /></header>
    {state.players.filter(p => p.id !== me).map(p => <section key={p.id} className="foresight-player" data-foresight-player={p.id} aria-label={`${p.name}的手牌`}><h3>{p.name}<small>{p.count} 张</small></h3><div className="foresight-cards">{sortCards(p.hand || [], foresightSort || handSort).map((card: CardView) => <Card key={card.id} card={card} />)}</div></section>)}
  </section>;
}

export function TableScreen({ model }: { model: RoomModel }) {
  const { state, me, spectating, practice, networkReady, domestic } = model;
  const player = state.players.find(p => p.id === me), selfIndex = state.players.findIndex(p => p.id === me);
  const myTurn = !spectating && state.players[state.turn]?.id === me;
  const done = ['trickEnd', 'roundEnd', 'finished'].includes(state.phase);
  const lead = leadInfo(state);
  const currentWinner = state.trick.length ? winner(state.trick, state.trump, state.options.deckMode) : null;
  const prompt = state.phase === 'bid' ? bidPrompt(state, me) : myTurn ? state.phase === 'trump' ? '选择本轮主牌' : '轮到你出牌' : `等待 ${state.players[state.turn]?.name} ${state.phase === 'trump' ? '选色' : '出牌'}`;
  const ownAction = state.phase === 'bid' ? state.canBid : myTurn && ['play', 'trump'].includes(state.phase);
  const bidAttention = state.canBid && !spectating && (practice || networkReady) && !state.lifecycle?.paused && !state.lifecycle?.reconnecting && !state.lifecycle?.continuationVote;
  return <div className="game-layout"><main>
    <div className="roundbar" aria-label={`第 ${state.round} 轮，共 ${state.maxRounds} 轮；已完成 ${state.completedTricks} 墩，共 ${state.cardsPerRound} 墩；顺时针出牌`}><span>轮 <b>{state.round}</b> / {state.maxRounds}</span><span className="trick-progress">墩 <b>{state.completedTricks}</b> / {state.cardsPerRound}</span></div>
    <section className="table"><div className="table-props" aria-hidden="true"><i className="prop-candle candle-left" /><i className="prop-candle candle-right" /><i className="prop-book">✦</i><i className="prop-orb" /><i className="prop-deck" /><i className="prop-coins" /></div><div className="table-ring" />
      <div className="opponents" data-count={state.players.length} aria-label="围桌席位">{state.players.filter(p => p.id !== me).map(p => {
        const index = state.players.findIndex(other => other.id === p.id), pos = seatPosition(index, selfIndex, state.players.length);
        const identity = `${p.name} · 实赢 ${p.won} · 预测 ${p.bid ?? (p.bidSubmitted ? '已锁定' : '未预测')}${index === state.dealer ? ' · 庄家' : ''}${!p.online ? ' · 离线' : ''}`;
        const active = !done && !(state.phase === 'bid' && state.options.predictionMode !== 'public') && state.turn === index;
        return <div key={p.id} className={`player ${lead?.seat === index ? 'lead-seat' : ''} ${!p.online ? 'offline' : ''} ${active ? 'active' : ''}`} role="group" aria-label={identity} data-seat={pos.seat} data-player={p.id} style={{ '--seat-x': `${pos.x}%`, '--seat-y': `${pos.y}%` } as CSSProperties} title={identity}>
          <SeatDetails model={model} player={p} index={index} lead={lead?.seat === index ? lead : null}><span className="seat-name">{domestic ? p.name : shortSeatName(p.name, pos.seat)}{domestic && (p.nicknameBadge ?? 0) > 1 && <small>#{p.nicknameBadge}</small>}{domestic && p.bot && <small>电脑</small>}</span></SeatDetails>
          <span className="prediction"><span aria-label={`实赢 ${p.won} 墩`}><small>赢</small><b>{p.won}</b></span><span aria-label={Number.isInteger(p.bid) ? `预测 ${p.bid} 墩` : p.bidSubmitted ? '预测已锁定，未公开' : '尚未预测'} className={Number.isInteger(p.bid) ? '' : 'target-secret'}><small>估</small><b>{p.bid ?? (p.bidSubmitted ? <Icon name="lock" /> : '—')}</b></span></span>
          {active && <span className="turn-label"><Icon name={state.phase === 'play' ? 'play' : 'target'} />{state.phase === 'play' ? '出牌' : state.phase === 'bid' ? '预测' : '选色'}</span>}
        </div>;
      })}</div>
      <Foresight model={model} />
      <div className={`played-cards ${state.players.length >= 5 ? 'compact-trick' : ''}`} style={{ inset: 0 }}>{state.trick.map((play, index) => {
        const seat = relativeSeat(play.player, selfIndex, state.players.length), motion = model.cardTiming(play.card.id!);
        const owner = state.players[play.player], winning = currentWinner === play.player;
        const status = winning ? done ? '赢墩' : '领先' : index === 0 ? '首攻' : '';
        return <div key={play.card.id} className={`played ${winning ? 'winner' : ''} ${motion.enterMs < CARD_ENTER_MS ? 'card-enter' : ''} ${motion.collectMs !== null ? 'collect-winner' : ''}`} role="img" aria-label={`${owner.name}：${cardLabel(play.card)}${winning ? done ? '，赢墩' : '，当前领先' : ''}`} data-card-id={play.card.id} data-play-seat={seat} data-player={owner.id} style={{ '--play-x': '50%', '--play-y': '50%' } as CSSProperties}><Card card={play.card} /><span className="card-contact-shadow" aria-hidden="true" /><small title={owner.name}><span className="played-name">{owner.name}</span><span className="played-state" data-compact={status}>{status || '\u00a0'}</span><span className="played-value">{cardLabel(play.card)}</span></small></div>;
      })}</div><div className="table-caption">已完成 {state.completedTricks} / {state.cardsPerRound} 墩</div>
    </section>
    <OwnStatus model={model} player={player} />
    {done ? <Settlement model={model} /> : <section className={`action-panel bid-phase-${state.phase} ${bidAttention ? 'bid-attention' : ''} ${ownAction ? 'your-action' : ''}`}>
      {state.phase === 'play' && !player && <span id="turn-countdown" role="timer" />}
      <div className="action-title"><h3>{state.lifecycle?.paused ? '牌局已暂停' : prompt.replace('点击金边手牌出牌', '选牌并确认出牌')}</h3><small className="win-reason">{state.phase === 'bid' ? '' : followSuitHint(state, me)}</small></div>
      {state.canBid ? <div className="bid-options" style={{ '--bid-columns': state.bids.length } as CSSProperties} role="group" aria-label="选择预测赢墩数">{state.bids.map(value => <button key={value} className="bid" data-bid={value} aria-label={`预测赢 ${value} 墩`}>{value}</button>)}</div> : myTurn && state.phase === 'trump' && <div className="trump-options">{(SUITS as Suit[]).map(suit => <button key={suit} data-trump={suit} className={`suit-chip ${suit}`} aria-label={`选择${SUIT_NAMES[suit]}为主牌`}><Icon name={suit} />{SUIT_NAMES[suit].split(' · ')[0]}色</button>)}</div>}
    </section>}
    {!spectating && <Hand model={model} player={player} myTurn={myTurn} />}
  </main><Scores model={model} /></div>;
}
