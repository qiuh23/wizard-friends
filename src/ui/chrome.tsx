import { ruleSummary } from '../rule-ui.js';
import { winnerReason } from '../table-summary.js';
import { Icon, IconButton } from './primitives';
import type { UIModel, RoomModel } from './types';

function RoomOperations({model, toolbar = false}: {model: RoomModel; toolbar?: boolean}) {
  const {state, isHost, spectating} = model;
  if (toolbar) return isHost && !spectating ? <IconButton id="room-pause" name={state.lifecycle?.paused ? 'play' : 'pause'} label={state.lifecycle?.paused ? '恢复牌局' : '暂停牌局'}>{state.lifecycle?.paused ? '继续' : '暂停'}</IconButton> : null;
  return <nav className="room-operations" aria-label="房间操作">
    {state.phase === 'lobby' && isHost && !spectating && <button id="room-pause" className="visual-icon-button" aria-label={state.lifecycle?.paused ? '恢复牌局' : '暂停牌局'} title={state.lifecycle?.paused ? '恢复牌局' : '暂停牌局'}><Icon name={state.lifecycle?.paused ? 'play' : 'pause'}/></button>}
    <button id="leave" className="text-button visual-icon-button" aria-label={spectating ? '退出观战' : '离开房间'} title={spectating ? '退出观战' : '离开房间'}><Icon name="back"/></button>
    {isHost && !spectating && <button id="room-dissolve" className="danger">解散房间</button>}
  </nav>;
}
export function LobbyOperations({model}: {model: RoomModel}) { return <RoomOperations model={model}/>; }
function SettingsContents({model}: {model: UIModel}) {
  return <>
    <button id="graphics" className="text-button graphics-toggle">◇ 3D 质感</button>
    <span className="control-host" data-music-host=""/>
    <button id="trump-motion" className="text-button">主牌动画</button>
    <button id="turn-sound">行动提示音：{model.turnSound ? '开' : '关'}</button>
    <span className="landscape-control" data-landscape-control=""><button type="button" data-screen-direction="" aria-pressed="false">横屏</button><small className="landscape-help" data-landscape-help="" role="status" aria-live="polite" hidden/></span>
    <div className="lobby-navigation"><button type="button" data-lobby-navigation="" disabled={model.busy && !model.state}>返回游戏大厅</button></div>
  </>;
}
export function RulesButton() { return <button className="text-button visual-icon-button" id="rules" aria-label="游戏规则" title="游戏规则"><Icon name="rules"/></button>; }
export function QuickSettings({model}: {model: UIModel}) {
  return <details id="quick-settings" open={model.settingsOpen}>
    <summary aria-label="设置" title="设置"><Icon name="settings"/></summary>
    <div className="settings-content"><button type="button" id="close-settings" className="visual-icon-button settings-close" aria-label="关闭设置" title="关闭设置"><Icon name="close"/></button>
      <SettingsContents model={model}/>{model.state && <RulesButton/>}
      <span className="control-host" data-rename-host=""/>
    </div>
  </details>;
}
export function GameToolbar({model}: {model: RoomModel}) {
  return <nav className="game-toolbar" aria-label="对局工具">
    <span className="control-host" data-chat-host=""/><RoomOperations model={model} toolbar/>
    <IconButton id="table-scores" name="scores" label="计分表与玩家信息" aria-controls="table-score-panel" aria-expanded={model.scoresOpen}>记分</IconButton>
    <IconButton id="table-menu" name="menu" label="菜单与设置" aria-controls="table-menu-panel" aria-expanded={model.menuOpen}>菜单</IconButton>
  </nav>;
}
export function GameMenu({model}: {model: RoomModel}) {
  const reason = winnerReason(model.state.trick, model.state.trump, model.state.options.deckMode);
  return <section id="table-menu-panel" className="table-menu-panel" aria-label="菜单与设置" hidden={!model.menuOpen}>
    <p>{model.practice ? '离线练习' : `房间 ${model.room}`}</p>
    <p className="menu-result-info">预测命中：20 + 10 × 实赢；未中：每差 1 墩扣 10 分。轮末自动发牌，离线时等待重连。</p>
    {reason && <p>{reason}</p>}<p className="current-rules">{ruleSummary(model.state.options)}</p>
    <RulesButton/><SettingsContents model={model}/>
    {!model.practice && <button id="invite" className="visual-icon-button" aria-label={model.spectating ? '复制观战邀请' : '复制邀请链接'} title="复制邀请链接"><Icon name="invite"/></button>}
    <span className="control-host" data-rename-host=""/><RoomOperations model={model}/>
  </section>;
}
export function Lifecycle({model}: {model: RoomModel}) {
  const life = model.state.lifecycle || {}, vote = life.continuationVote;
  const deadline = life.retentionDeadline ? new Date(life.retentionDeadline).toLocaleString('zh-CN', {hour12:false}) : null;
  return <>
    {(life.paused || life.hostOffline || life.closeAfterRound) && <div className="lifecycle-banner" role="status">
      {life.paused ? `已暂停 · ${life.pauseReason || '房主主动暂停'}` : life.hostOffline ? '房主离线 · 牌局进度已保留' : ''}{life.closeAfterRound && ' · 仅完成当前轮，结果确认后关闭'}
      <small>{deadline ? `${life.paused && !life.hostOffline ? '本次暂停再次离线仍沿用截止' : '保留截止'} ${deadline}` : model.practice ? '离开后原浏览器保留 10 分钟' : '房主在线时不因闲置过期'}{deadline && life.hostOffline && !vote && !life.closeAfterRound && <> · <span id="retention-countdown" role="timer"/>；到期符合条件时发起 60 秒续赛投票，否则关闭</>}</small>
    </div>}
    {vote && <div className="continuation-panel" role="dialog" aria-modal="true" aria-label="到期续赛投票"><h2>房间保留时间已到</h2><p>全体在线真人同意后，仅完成当前轮；任一拒绝或 60 秒未全员确认即关闭。</p><p>{vote.accepted.length} / {vote.voters.length} 已同意 · <span id="continuation-countdown"/></p>
      {vote.voters.includes(model.me) ? <><button id="continue-no">拒绝并关闭</button><button id="continue-yes" className="primary" disabled={vote.accepted.includes(model.me)}>{vote.accepted.includes(model.me) ? '已同意，等待其他人' : '同意完成本轮'}</button></> : <p>等待投票结果</p>}
    </div>}
  </>;
}
