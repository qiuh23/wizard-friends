import type { ReactNode } from 'react';
import { avatarCharacter } from '../graphemes.js';
import { RULE_LABELS, ruleSummary } from '../rule-ui.js';
import { RULE_CHOICES } from '../rules-options.js';
import type { UIModel, RoomModel } from './types';
import { Card, Icon } from './primitives';

/** The existing home composition, with imperative directory/presence islands. */
export function HomeScreen({ model }: { model: UIModel }) {
  const { domestic, busy, nickname, lobbyURL, joinOpen, joinDraft, roomInput, returnRooms, practiceSaved } = model;
  return <main className="home-screen">
    <section className="hero home-scene" aria-label="烛光牌桌">
      <div className="hero-cards">
        <Card card={{ kind: 'number', suit: 'blue', rank: 13 }} />
        <Card card={{ kind: 'wizard' }} />
        <Card card={{ kind: 'number', suit: 'red', rank: 7 }} />
      </div>
    </section>
    <section className="home-menu" aria-label="主菜单">
      <nav className="entry-context" aria-label="当前线路与游戏大厅">
        <a href={lobbyURL} data-lobby-navigation="" aria-disabled={busy || undefined}><Icon name="back" />返回大厅</a>
        <span className="current-route">{domestic ? '国内站' : '海外站'}</span>
      </nav>
      <div className="home-title"><h1>巫师牌</h1></div>
      <div className="menu-identity">
        <label htmlFor="nickname">昵称</label>
        {domestic ? <>
          <output id="nickname">{nickname}</output>
          <button type="button" id="random-nickname" className="visual-icon-button" aria-label="随机换一个昵称" title="随机换一个昵称" disabled={busy}><Icon name="reconnect" /></button>
        </> : <input id="nickname" maxLength={16} placeholder="请输入昵称" required autoComplete="nickname" defaultValue={nickname} />}
      </div>
      <nav className="menu-options" aria-label="开始游戏">
        {returnRooms.map((recovery, index) => <button key={`${recovery.room}:${index}`} id={index === 0 ? 'resume-room' : undefined} data-return-room={index} className="menu-choice">
          返回 {recovery.room} · {recovery.role === 'host' ? '房主' : recovery.role === 'spectator' ? '观战' : '玩家'}
        </button>)}
        <button id="create" className="menu-choice menu-primary" disabled={busy}>{busy ? '正在连接…' : '创建房间'}<span className="menu-choice-icon"><Icon name="cards" /></span></button>
        <button id="join-menu" className="menu-choice" aria-expanded={joinOpen} aria-controls="join-form" disabled={busy}>加入房间<span className="menu-choice-icon"><Icon name="enter" /></span></button>
        <form id="join-form" className="menu-join" hidden={!joinOpen}>
          <label className="sr-only" htmlFor="room-input">房间码</label>
          <input id="room-input" placeholder="输入房间码" maxLength={24} autoComplete="off" defaultValue={joinDraft ?? roomInput} />
          <button id="join" type="submit" disabled={busy}>加入</button>
        </form>
        {practiceSaved && <button id="resume-practice" className="menu-choice">恢复练习<span>↗</span></button>}
        <button id="practice" className="menu-choice" disabled={busy}>单人练习<span className="menu-choice-icon"><Icon name="target" /></span></button>
        {busy && <button id="cancel-connect" className="text-button">取消连接</button>}
      </nav>
      <div className="home-presence">
        <span id="online-count" role="status" title="当前网站已连接的浏览器数（含牌局中玩家），同一浏览器多个标签页合并。断网或手机后台挂起时，离线检测可能延迟。" />
      </div>
      <aside className="home-room-list" aria-label="在线房间" />
    </section>
  </main>;
}

/** Waiting-room heading; persistent room controls are supplied by the shell. */
export function RoomHeading({ model, children }: { model: RoomModel; children?: ReactNode }) {
  const { state, practice, spectating, publicCode, lobbyPanel, lobbyURL } = model;
  return <div className="room-heading">
    <div className="room-identity">
      <span>{practice ? '练习牌桌' : spectating ? '观战房间' : '房间'}</span>
      <span className="room-code">{practice ? '' : publicCode}</span>
      <span className="seat-count">{state.players.length} / 6{!practice && ` · ${state.spectatorCount || 0} 人观战`}</span>
      <a className="room-lobby-link visual-icon-button" href={lobbyURL} data-lobby-navigation="" aria-label="返回游戏大厅" title="返回游戏大厅"><Icon name="back" /></a>
    </div>
    <div className="room-buttons">
      {!practice && <button id="invite" className="visual-icon-button" aria-label={spectating ? '复制观战邀请' : '复制邀请链接'} title={spectating ? '复制观战邀请' : '复制邀请链接'}><Icon name="invite" /></button>}
    </div>
    <nav className="room-tabs" role="tablist" aria-label="房间设置">
      <button type="button" id="room-players-tab" role="tab" data-lobby-panel="players" aria-controls="room-players-panel" aria-selected={lobbyPanel === 'players'} tabIndex={lobbyPanel === 'players' ? 0 : -1}>玩家入座 <span>{state.players.length} / 6</span></button>
      <button type="button" id="room-rules-tab" role="tab" data-lobby-panel="rules" aria-controls="room-rules-panel" aria-selected={lobbyPanel === 'rules'} tabIndex={lobbyPanel === 'rules' ? 0 : -1}>整局玩法</button>
    </nav>
    <p className="lobby-current" role="status"><Icon name="cards" />{ruleSummary(state.options)}</p>
    {children}
  </div>;
}

const ruleMarks = { deckMode: 'cards', predictionMode: 'target', strict: 'sort', foresight: 'eye', short: 'clock' };
type RuleKey = keyof typeof RULE_LABELS;

export function RuleSetup({ model }: { model: RoomModel }) {
  const { state, isHost } = model;
  return <section className="rules-setup" aria-label={`整局玩法${isHost ? '，房主选择' : '，由房主选择'}`}>
    <form id="rules-form"><div className="rule-groups">
      {Object.entries(RULE_CHOICES).map(([key, values]) => {
        const ruleKey = key as RuleKey;
        const labels = RULE_LABELS[ruleKey];
        const valueLabels: Record<string, string> = labels.values;
        // Reconcile the acknowledged option without retaining a rejected draft.
        return <fieldset key={`${key}:${String(state.options[ruleKey])}`}>
          <legend><Icon name={ruleMarks[ruleKey]} />{labels.title}</legend>
          <div className="rule-choices">{values.map(value => {
            const unavailable = (ruleKey === 'deckMode' && value === 'mono' && state.players.length > 4) || (ruleKey === 'strict' && state.options.predictionMode !== 'public');
            const restriction = ruleKey === 'deckMode' && value === 'mono' ? ' · 3–4 人' : ruleKey === 'strict' && unavailable ? ' · 需公开预估' : '';
            return <label key={String(value)} title={labels.hint}>
              <input type="radio" name={key} value={String(value)} defaultChecked={state.options[ruleKey] === value} disabled={!isHost || unavailable} />
              <span>{valueLabels[String(value)]}{restriction}</span>
            </label>;
          })}</div>
        </fieldset>;
      })}
    </div></form>
  </section>;
}

export function LobbyScreen({ model }: { model: RoomModel }) {
  const { state, me, domestic, isHost, lobbyPanel, preferredBotDifficulty } = model;
  return <main className="lobby-table has-rule-setup" data-active-panel={lobbyPanel}>
    <div className="hero lobby-scene" aria-hidden="true"><div className="lobby-felt" /></div>
    <div className="lobby-content">
      <section id="room-players-panel" className="lobby-panel" role="tabpanel" tabIndex={0} aria-labelledby="room-players-tab" hidden={lobbyPanel !== 'players'}>
        <div className="seats" aria-label="房间座位">
          {state.players.map((player, index) => <div key={player.id} className={`seat ${player.id === me ? 'my-seat' : ''} ${player.bot ? 'bot-seat' : 'human-seat'} ${!player.online ? 'offline' : ''}`}>
            <div className="avatar" aria-hidden="true">{player.bot ? '✧' : avatarCharacter(player.name)}</div>
            <div className="seat-name"><b title={player.name}>{player.name}</b><small>
              {index === 0 ? '房主' : player.bot ? `${domestic ? '电脑' : '机器人'} · ${player.botDifficulty === 'simple' ? '简单' : '策略'}` : player.online ? '真人' : '真人 · 离线'}{player.id === me ? ' · 你' : ''}
            </small></div>
            {isHost && index > 0 && <button data-remove={player.id} className="text-button" aria-label={`移除${player.bot ? '机器人' : '玩家'} ${player.name}`} title={`移除${player.bot ? '机器人' : '玩家'}`}>×</button>}
          </div>)}
          {Array.from({ length: Math.max(0, 6 - state.players.length) }, (_, index) => <div key={`empty:${index}`} className="seat empty"><div className="avatar" aria-hidden="true">＋</div><div className="seat-name"><b>空位</b></div></div>)}
        </div>
        {isHost && state.players.length < 6 && <div className="lobby-options bot-controls" role="group" aria-label="添加机器人">
          <label className="sr-only" htmlFor="bot-difficulty">机器人难度</label>
          <select id="bot-difficulty" defaultValue={preferredBotDifficulty}><option value="smart">策略陪练</option><option value="simple">简单陪练</option></select>
          <button id="addbot" type="button">＋ 添加机器人</button>
        </div>}
      </section>
      <section id="room-rules-panel" className="lobby-panel" role="tabpanel" tabIndex={0} aria-labelledby="room-rules-tab" hidden={lobbyPanel !== 'rules'}><RuleSetup model={model} /></section>
    </div>
  </main>;
}

export function LobbyStart({ model }: { model: RoomModel }) {
  const { state, isHost } = model;
  const startHint = state.players.length < 3 ? `还差 ${3 - state.players.length} 人` : state.players.some(player => !player.online) ? '等待玩家重连' : state.options.deckMode === 'mono' && state.players.length > 4 ? '单色限 3–4 人，请选择标准牌库' : '';
  return <div className="lobby-controls"><div className="lobby-start">
    {isHost ? <>{startHint && <span className="start-hint">{startHint}</span>}<button id="start" className="primary" disabled={!!startHint}>开始游戏 →</button></> : <span className="start-hint">等待 {state.players[0]?.name} 开始游戏</span>}
  </div></div>;
}
