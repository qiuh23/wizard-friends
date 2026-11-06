import { nicknameFromId, randomNicknameId, migrateCNGame, enforceRequest, FOREIGN_INVITATION } from './site-policy.js';
import { safetyNoticeHTML, showSafetyNotice } from './safety-notice.js';
import { createGame, addPlayer, viewFor, botAction, normalizeGame, TRICK_REVIEW_MS, SUITS, SUIT_NAMES, winner } from './game.js';
import './style.css';
import './cinematic.css';
import './fullscreen.css';
import './lobby.css';
import './social.css';
import './clarity.css';
import { BackgroundMusic } from './music.js';
import { RoomSocial } from './room-social.js';
import { TrumpReveal, renderTrumpDisplay, layoutTrumpDisplay } from './trump-display.js';
import { validateName } from './player-names.js';
import { ruleSetupHTML, ruleSummary } from './rule-ui.js';
import { leadInfo, playerTotals, scoreHistoryHTML, winnerReason } from './table-summary.js';
import './variants.css';
import { cardImage, loadCardImage } from './card-art.js';
import { createPresence } from './presence.js';
import { createRoomTransport } from './room-transport.js';
import { readRoomSession, saveRoomSession, clearRoomSession } from './room-session.js';
import { RoomDirectory } from './room-directory.js';
import { applyPublicAction } from './spectator-events.js';
import './spectator.css';
import './table-ui.css';
import './round-summary.css';
import './card-face.css';
import './table-dock.css';
import './table-clarity.css';
import './settlement.css';
import './trump-display.css';
import { settlementHTML } from './settlement.js';
import { cardMark, cardMarksHTML, preloadCardFaces } from './card-face.js';
import { captureHand, HandMotion } from './hand-motion.js';
import { CARD_ENTER_MS, LEADING_CARD_SCALE, COMPACT_LEADING_CARD_SCALE, TableMotion } from './table-motion.js';
import { tableLayoutMode, shortSeatName } from './table-layout.js';
import { frameScheduler } from './frame-scheduler.js';
import { createLayoutScheduler } from './layout-scheduler.js';
import { updateTableLayout } from './table-layout-dom.js';
import { tableViewKey, updateHandSelection, reorderHand } from './ui-regions.js';
import { seatPosition, relativeSeat, followSuitHint, playBlockedReason, sortCards, isSwipe } from './hand-model.js';
import { readRoomRecoveries, saveRoomRecovery, removeRoomRecovery } from './room-recovery.js';
import { PRACTICE_SAVE_KEY, PRACTICE_KEEP_MS, readPractice, savePractice, restorePracticeClock } from './practice-save.js';
import { turnStatus } from './turn-status.js';
import { uuidV4 } from './uuid.js';
import { backendId, backendStorage, isDomestic, gameLobbyURL, invitationURL, parseRoomCode, publicRoomCode, readInvitation, runtimeConfig } from './backend-entry.js';
import './game-navigation.css';
import { copyInvitation } from './share-link.js';
import { readNickname, saveNickname } from './nickname-preference.js';
import { ScoreBubbles } from './score-bubbles.js';
import './score-bubbles.css';
import { ScreenDirection, screenDirectionControlHTML } from './screen-direction.js';
import './screen-direction.css';
import './room-experience.css';
import './foresight.css';
import { icon, setIconButton } from './ui-icons.js';
import './immersive-table.css';
// Homepage owns its full visual cascade after the shared table styles.
import './home-menu.css';
import { FloatingLayers, containsEvent } from './floating-layers.js';

new ScreenDirection();

const sessionStore = backendStorage(globalThis.sessionStorage);
const localStore = backendStorage(globalThis.localStorage);

let onlinePresence = { count: null, status: 'connecting' };
function updateOnlineCount() {
  const badge = document.querySelector('#online-count');
  if (!badge) return;
  badge.dataset.status = onlinePresence.status;
  badge.textContent = onlinePresence.count === null
    ? (onlinePresence.status === 'connecting' ? '在线人数连接中…' : '在线人数暂不可用')
    : `约 ${onlinePresence.count} 人在线`;
}

let tableScene, scenePending = false, sceneFailed = false;
let refreshHandOnLayout = false;
const layoutSchedule = createLayoutScheduler(({force}) => {
  if (updateLayoutMetrics(force)) tableScene?.resize();
  if (refreshHandOnLayout) {
    refreshHandOnLayout = false;
    handMotion.attach($('.hand'), null, selectedCard);
  }
  htmlLinks = $('.played-links');
  htmlFrame.request();
});
const tableLayoutObserver = new ResizeObserver(() => layoutSchedule.request());
const motionMedia = matchMedia('(prefers-reduced-motion: reduce)');
let trumpMotionPreference = localStore.getItem('wizard-trump-motion');
function updateTrumpMotion() {
  const enabled = trumpMotionPreference === null ? !motionMedia.matches : trumpMotionPreference === 'true';
  document.body.dataset.trumpMotion = enabled ? 'on' : 'off';
  if (tableScene) tableScene.trumpMotion = enabled;
  if (!enabled || motionMedia.matches) trumpReveal.finish();
  const button = document.querySelector('#trump-motion');
  if (button) {
    button.textContent = `主牌动画：${enabled ? '开' : '关'}`;
    button.setAttribute('aria-pressed', String(enabled));
    button.title = motionMedia.matches
      ? '已跟随系统减少动态效果，直接显示当前主牌' : '切换每轮主牌揭示动画，自动记住选择';
  }
}
motionMedia.addEventListener('change', () => {
  updateTrumpMotion();
  tableMotion.reducedMotion = motionMedia.matches;
  tableMotion.setEmphasisScale(document.body.dataset.tableLayout === 'strip' ? COMPACT_LEADING_CARD_SCALE : LEADING_CARD_SCALE, {immediate:true});
  layoutSchedule.request({force:true}); htmlFrame.request(); tableScene?.requestDraw();
});
function syncScene() {
  const target = document.querySelector('.table') || document.querySelector('.hero');
  let mount = document.querySelector('#scene-host');
  if (target && !mount) {
    mount = document.createElement('div'); mount.id = 'scene-host';
    mount.className = 'scene-host'; mount.setAttribute('aria-hidden', 'true');
    target.prepend(mount);
  }
  if (!state) tableMotion.sync(null);
  if (tableScene) { tableScene.motion = tableMotion; tableScene.viewer = me; tableScene.attach(mount, state, {deferResize:true}); layoutSchedule.request(); }
  else if (target && !scenePending && !sceneFailed) {
    scenePending = true;
    import('./table-scene.js').then(({ TableScene }) => {
      try {
        tableScene = new TableScene({onInvalidate:() => {
          layoutSchedule.request({force:true}); htmlFrame.request();
        }}); updateTrumpMotion(); syncScene(); updateGraphicsButton();
      } catch {
        sceneFailed = true; document.body.classList.remove('has-webgl'); updateGraphicsButton();
      }
    }).catch(() => { sceneFailed = true; updateGraphicsButton(); });
  }
}
function updateGraphicsButton() {
  const button = document.querySelector('#graphics');
  if (!button) return;
  button.textContent = sceneFailed ? '◇ 2D 模式' : tableScene?.low ? '◇ 省电' : '◇ 3D 质感';
  button.disabled = sceneFailed || !tableScene;
  button.setAttribute('aria-label', sceneFailed ? 'WebGL 不可用，已自动使用二维界面' : '切换三维画面质量与省电模式');
}

const $ = s => document.querySelector(s);
const escape = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const symbols = { blue: '❄', red: '♜', green: '❧', yellow: '✧', wizard: '✦', jester: '☾' };
const phaseNames = { lobby: '等待好友入座', trump: '选择王牌', bid: '预言阶段', play: '出牌阶段', trickEnd: '本墩结算', roundEnd: '本轮结算', finished: '终局 · 预言揭晓' };
const app = $('#app');
let transport, game, state, isHost = false, practice = false, room = '', me = '', identities = {};
let spectating = false;
let botTimer, status = '', busy = false, rulesOpen = false, networkReady = false;
let preferredBotDifficulty = 'smart';
let lobbyPanelRoom = '', lobbyPanel = 'players', lobbyPanelScroll = {players:0,rules:0};
let ruleExtrasOpen = false;
let roomEpoch = 0;
let scoresOpen = false, menuOpen = false;
let scoreSource = null;
let settingsOpen = false, turnTimer, serverClockOffset = 0;
let joinOpen = new URLSearchParams(location.search).has('room');
let joinDraft = null;
let pendingPlay = null, pendingSettlement = null, noticeTimer;
const handMotion = new HandMotion(showHoveredCard);
const tableMotion = new TableMotion();
const trumpReveal = new TrumpReveal();
const scoreBubbles = new ScoreBubbles();
let selectedCard = null, handExpanded = false, handCollapsed = false, handSort = sessionStore.getItem('wizard-hand-sort') === 'rank' ? 'rank' : 'suit', handScroll = 0, gridScroll = 0, selectionContext = '';
let foresightSort = ['suit', 'rank'].includes(sessionStore.getItem('wizard-foresight-sort')) ? sessionStore.getItem('wizard-foresight-sort') : null;
let renderedTableKey = null, renderedJournal = '';
let selectionPointer = null;
document.addEventListener('pointerdown', event => {
  selectionPointer = { id:event.pointerId, x:event.clientX, y:event.clientY, dragged:false };
}, {capture:true, passive:true});
document.addEventListener('pointermove', event => {
  if (selectionPointer?.id === event.pointerId && isSwipe(selectionPointer, {x:event.clientX,y:event.clientY})) selectionPointer.dragged = true;
}, {capture:true, passive:true});
document.addEventListener('pointercancel', () => { if (selectionPointer) selectionPointer.dragged = true; }, {capture:true, passive:true});
// Capture before a control's handler can redraw the hand and detach its target.
document.addEventListener('click', event => {
  if (!selectedCard || pendingPlay || event.button !== 0 || selectionPointer?.dragged) return;
  if (!(event.target instanceof Element) || event.target.closest('button,a,input,select,textarea,summary,label,dialog,[role="dialog"],[role="button"],[contenteditable="true"],#table-menu-panel,#table-score-panel,#room-chat,#rename-panel,.settings-content,.settlement-details-body')) return;
  selectedCard = null; refreshSelection();
}, true);
let seenEventSeq = null, lastTurnCue = '', turnSound = localStore.getItem('wizard-turn-sound') !== 'false';
let practicePaused = false, practiceRemaining = null, practiceCollection = null;
let practiceSaved = readPractice(localStore);

const tokenKey = 'wizard-player-token';
let token = sessionStore.getItem(tokenKey);
if (!token) { token = uuidV4(); sessionStore.setItem(tokenKey, token); }
const domestic = isDomestic();
document.body.dataset.siteEdition = domestic ? 'cn' : 'global';
let selectedNicknameId = domestic ? localStore.getItem('wizard-cn-nickname-id') : null;
if (domestic && !nicknameFromId(selectedNicknameId)) selectedNicknameId = randomNicknameId();
let nickname = domestic ? nicknameFromId(selectedNicknameId) : readNickname(localStore, sessionStore);
let automaticName = false;
persistName();
const initialCode = readInvitation(location.search);
const roomFromURL = initialCode ? publicRoomCode(initialCode.room, initialCode.backendId) : '';
const watchFromURL = initialCode?.watch === true;
const invitedRoom = initialCode?.backendId === backendId() ? initialCode.room : roomFromURL;
// A foreign invitation must not move a recovering in-progress room to another
// pool. Keep its original authority and credentials; switching stays on home.
const currentSession = readRoomSession(sessionStore);
const savedSession = initialCode && initialCode.backendId !== backendId() && currentSession
  ? currentSession : readRoomSession(sessionStore, invitedRoom);
const storedRoom = savedSession?.room || '';
function notify(message) {
  clearTimeout(noticeTimer);
  status = message; const el = $('#notice'); if (el) el.textContent = message;
  // Recoverability is shown by the permanent room controls; this acknowledgement
  // must not sit over a seat for the rest of a round.
  if (message && /^(已恢复|已回到|已加入|房间已准备)/.test(message)) noticeTimer=setTimeout(()=>{
    if(status===message) { status='';const current=$('#notice');if(current)current.textContent=''; }
  },3000);
}
function showHoveredCard(id) {
  const card=state?.players.find(p=>p.id===me)?.hand?.find(c=>c.id===id);
  const preview=$('.hover-preview'),selected=$('.selected-preview');
  if(!preview)return;
  preview.hidden=!card || id===selectedCard;
  if(selected)selected.hidden=!!card && id!==selectedCard;
  if(card && id!==selectedCard)preview.innerHTML=`${cardHTML(card)}<span>查看 ${escape(cardLabel(card))}</span><small>点击选中，再确认出牌</small>`;
}
function pendingContext(value=state) {return value ? `${value.round}:${value.completedTricks}:${value.phase}:${value.turn}:${!!value.lifecycle?.paused}:${networkReady}` : '';}

function persistName() {
  if (domestic) {
    localStore.setItem('wizard-cn-nickname-id', selectedNicknameId);
    for (const storage of [localStore, sessionStore]) {storage.removeItem('wizard-name'); storage.removeItem('wizard-name-automatic');}
  } else saveNickname(localStore, sessionStore, nickname, automaticName);
}
function cardLabel(c) {
  return c.kind === 'wizard' ? '巫师 W' : c.kind === 'jester' ? '小丑 J' : `${SUIT_NAMES[c.suit].split(' · ')[0]} ${c.rank}`;
}
function cardHTML(c, inspectable = false, legal = false, selected = false) {
  loadCardImage(c).catch(() => {});
  const special = c.kind !== 'number';
  const label = c.kind === 'wizard' ? '巫师' : c.kind === 'jester' ? '小丑' : SUIT_NAMES[c.suit].split(' · ')[1];
  const value = special ? (c.kind === 'wizard' ? 'W' : 'J') : c.rank;
  return `<button class="card ${c.suit || c.kind} ${legal ? 'playable' : ''} ${selected ? 'selected' : ''}" style="--card-color:${cardMark(c).color};background-image:url('${cardImage(c)}')" ${inspectable ? `data-card="${escape(c.id)}" aria-pressed="${selected}"` : `data-visible-card="${escape(c.id)}" disabled tabindex="-1"`} aria-label="${escape(cardLabel(c))}${legal ? '，合法牌' : ''}${selected ? '，已选中' : ''}" title="${label} ${value}">${cardMarksHTML(c)}</button>`;
}
const avatarColors = ['#94d6cb', '#eeb9a4', '#a9caff', '#f1d37b', '#c9b4ec', '#b9d59a'];
function avatarHTML(player, index, lead = null) {
  const detail = `${player.name}${player.id === me ? ' · 你' : ''}${lead ? ` · ${lead.label}` : ''}`;
  return `<button class="avatar" data-player-details="${escape(player.id)}" style="--avatar-color:${avatarColors[index % avatarColors.length]}" aria-controls="table-score-panel" aria-expanded="false" aria-label="查看 ${escape(detail)} 的信息" title="${escape(detail)}">${escape(player.name.slice(0, 1))}<small class="avatar-seat">${index+1}</small>${lead ? `<span class="lead-badge" aria-hidden="true">先</span>` : ''}</button>`;
}
function ownStatusHTML(p) {
  if (!p) return '';
  const lead = leadInfo(state), index = state.players.findIndex(x => x.id === p.id);
  const ownTurn = state.players[state.turn]?.id === me;
  const compactAction=state.phase==='play' ? `<div class="own-action"><span><b>${icon(!practice && !networkReady ? 'reconnect' : state.lifecycle?.paused ? 'pause' : state.lifecycle?.reconnecting ? 'reconnect' : ownTurn ? 'play' : 'clock')}${!practice && !networkReady ? '重连中' : state.lifecycle?.paused ? '已暂停' : state.lifecycle?.reconnecting ? '等待重连' : ownTurn ? '你出牌' : `等 ${escape(shortSeatName(state.players[state.turn]?.name, relativeSeat(state.turn, index, state.players.length)))}`}</b><small class="follow-requirement">${ownTurn ? escape(followSuitHint(state, me)) : ''}</small><small class="play-block-reason" role="status" aria-live="polite" hidden></small></span><span id="turn-countdown" role="timer"></span></div>` : '';
  return `<section class="own-status ${(state.phase === 'bid' ? state.canBid : ['play','trump'].includes(state.phase) && ownTurn) ? 'active' : ''}" aria-label="你的本轮预测和成绩">${avatarHTML(p, index, lead?.seat === index ? lead : null)}<span class="own-name" title="${escape(p.name)}">${escape(p.name)}<small>你</small></span><div class="own-metrics"><span aria-label="实赢 ${p.won} 墩">${icon('trophy')}<small>赢</small><b>${p.won}</b></span><span aria-label="预测 ${p.bid ?? '未提交'} 墩">${icon('target')}<small>估</small><b>${p.bid ?? '—'}</b></span></div>${compactAction}</section>`;
}
function handHTML(p, myTurn) {
  if (state.foresightActive) return '<section class="concealed-hand" aria-label="你的手牌" role="status">手牌暂时保密，全员预测后揭晓</section>';
  const cards = sortCards(p?.hand || [], handSort), selected = cards.find(c => c.id === selectedCard);
  const reason = pendingPlay ? '正在提交，等待房间确认' : selected ? (!networkReady && !practice ? '连接恢复中，重新连接后再选择' : playBlockedReason(state, me, selected)) : '';
  return `<div class="hover-preview" hidden aria-live="polite"></div><div class="selected-preview" aria-live="polite" ${selected ? '' : 'hidden'}>${selected ? `${cardHTML(selected)}<span>已选 ${escape(cardLabel(selected))}</span>${reason ? `<small>${escape(reason)}</small>` : ''}` : ''}</div><section class="hand-section ${handExpanded ? 'expanded' : ''} ${handCollapsed ? 'collapsed' : ''}" aria-label="你的手牌"><div class="hand-heading"><span class="hand-count" aria-label="手牌 ${p?.count ?? cards.length} 张">${icon('cards')}${p?.count ?? cards.length}</span><button id="hand-collapse" aria-expanded="${!handCollapsed}">${handCollapsed ? '展开手牌' : '收起手牌'}</button><button id="hand-sort" aria-label="切换手牌排序">${handSort === 'suit' ? '花色排序' : '点数排序'}</button><button id="hand-expand" aria-label="${handExpanded ? '收起展开手牌' : '展开全部手牌'}" title="${handExpanded ? '收起展开手牌' : '展开全部手牌'}" aria-expanded="${handExpanded}">${handExpanded ? '⌄' : '⤢'}</button></div><div class="hand ${handExpanded ? 'hand-grid' : 'hand-strip'}" tabindex="0">${cards.map(c => cardHTML(c, true, myTurn && state.legal.includes(c.id), c.id === selectedCard)).join('') || '<p class="muted" aria-label="本轮手牌已出完"></p>'}</div>${state.phase === 'play' && myTurn && !state.lifecycle?.paused && !state.lifecycle?.continuationVote && (practice || networkReady) ? `<div class="play-confirm" data-submitting="${!!pendingPlay}" aria-busy="${!!pendingPlay}"><button id="confirm-play" class="primary" ${!selected || reason ? 'disabled' : ''} title="${escape(reason || (selected ? `打出 ${cardLabel(selected)}` : '请先选择手牌'))}">${pendingPlay ? '正在提交…' : '出牌'}</button></div>` : ''}</section>`;
}
function lifecycleHTML() {
  const life = state.lifecycle || {}, vote = life.continuationVote;
  const deadline = life.retentionDeadline ? new Date(life.retentionDeadline).toLocaleString('zh-CN', {hour12:false}) : null;
  return `${life.paused || life.hostOffline || life.closeAfterRound ? `<div class="lifecycle-banner" role="status">${life.paused ? `已暂停 · ${escape(life.pauseReason || '房主主动暂停')}` : life.hostOffline ? '房主离线 · 牌局进度已保留' : ''}${life.closeAfterRound ? ' · 仅完成当前轮，结果确认后关闭' : ''}<small>${deadline ? `${life.paused && !life.hostOffline ? '本次暂停再次离线仍沿用截止' : '保留截止'} ${deadline}` : practice ? '离开后原浏览器保留 10 分钟' : '房主在线时不因闲置过期'}${deadline && life.hostOffline && !vote && !life.closeAfterRound ? ' · <span id="retention-countdown" role="timer"></span>；到期符合条件时发起 60 秒续赛投票，否则关闭' : ''}</small></div>` : ''}${vote ? `<div class="continuation-panel" role="dialog" aria-modal="true" aria-label="到期续赛投票"><h2>房间保留时间已到</h2><p>全体在线真人同意后，仅完成当前轮；任一拒绝或 60 秒未全员确认即关闭。</p><p>${vote.accepted.length} / ${vote.voters.length} 已同意 · <span id="continuation-countdown"></span></p>${vote.voters.includes(me) ? `<button id="continue-no">拒绝并关闭</button><button id="continue-yes" class="primary" ${vote.accepted.includes(me) ? 'disabled' : ''}>${vote.accepted.includes(me) ? '已同意，等待其他人' : '同意完成本轮'}</button>` : '<p>等待投票结果</p>'}</div>` : ''}`;
}

function shell(body) {
  if (!state) return `<div class="page">${body}<header class="topbar home-tools"><div class="top-actions">${safetyNoticeHTML()}<button class="text-button" id="rules">游戏规则</button></div></header></div><div id="notice" class="notice" role="status" aria-live="polite">${escape(status)}</div>${rulesOpen ? rulesHTML() : ''}`;
  return `<div class="page"><header class="topbar"><a class="brand" href="${location.pathname}"><span class="brand-icon">✦</span><span>巫师牌<small>WIZARD / FRIENDS TABLE</small></span></a><div class="top-actions">${safetyNoticeHTML()}<span class="tag">好友之间，预言成真</span><button class="text-button" id="rules">玩法说明</button></div></header>${body}<footer><span>一副牌，无数种预言。</span><span>非官方好友同乐版 · 牌面原创绘制</span></footer></div><div id="notice" class="notice" role="status" aria-live="polite">${escape(status)}</div>${rulesOpen ? rulesHTML() : ''}`;
}
function rulesHTML() {
  return `<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="rule-title"><button class="close" id="close-rules" aria-label="关闭规则">×</button><div class="eyebrow">THE ART OF PREDICTION</div><h2 id="rule-title">先预估，再出牌。</h2>
    <p>3–6 人，共 60 张牌：四种花色各 1–13，以及 4 张巫师、4 张小丑。标准牌库第 N 轮每人发 N 张牌。</p>
    <ol><li><b>确定主牌。</b>翻开的数字牌花色是本轮主牌；翻到巫师由庄家选色，小丑或牌库用尽则无主牌。</li><li><b>预估墩数。</b>公开预估从庄家左手开始。每人出一张牌，组成一墩。</li><li><b>依次出牌。</b>庄家左手边先出首墩，按座次依次出牌。手中有首攻花色的数字牌时必须跟色，不能改出其他颜色或主牌；W 和 J 随时能出。后出的 W 不解除跟色要求。巫师起手可任意出牌，小丑起手看第一张非小丑牌。</li><li><b>判定赢家。</b>最先出的巫师 ＞ 最大主牌 ＞ 首攻花色最大牌。全是小丑则第一张赢。赢家下一墩先出。</li><li><b>计分。</b>猜中得 20 + 10 × 赢墩数；猜错每差一墩扣 10 分。最高总分胜，同分共享胜利。</li></ol>
    <h3>开局前，房主选择整局玩法</h3><p>牌库、局长、预估方式、加减预估和先见之明都在大厅由房主选定，整个游戏沿用。其他玩家可以查看选项。每轮结算后直接发下一轮的牌；整局结束后可返回大厅调整玩法。</p>
    <ul><li><b>加减预估：</b>最后一人的预估不能使总和等于本轮墩数，仅搭配公开预估，可同时开启先见之明。</li><li><b>隐藏预估：</b>独立提交，全部提交后同时公开。</li><li><b>秘密数字：</b>独立提交，只能看自己的预估，本轮打完才公开所有人的数字。</li><li><b>先见之明：</b>开启的当轮预估时隐藏自己的整手牌，展示其他人的手牌。全部预估完恢复正常；单色模式也适用于当轮全部手牌。</li><li><b>单色牌库（3–4 人）：</b>每人独占一个随机花色 1–13，加 1 张巫师和 1 张小丑。第一轮发 4 张，逐轮增加，12 轮结束。每轮将所有牌归还原牌库重新洗牌；无主牌、不跟花色，数字跨花色比较，最大数字胜，同数字先出者较强。巫师、小丑及计分沿用基本规则。</li></ul>
    <p>标准完整局：3/4/5/6 人分别 20/15/12/10 轮。两种牌库均可选本站的 5 轮快速局，单色快速局每轮发 4–8 张。</p>
    <p class="muted">牌局自动保存。房主离线后保留 30 分钟；主动暂停的好友房最多保留 4 小时。练习离开后在原浏览器保留 10 分钟。</p><a href="https://blog.amigo-spiele.de/content/ap/rule/06900-GB-AmigoRule.pdf" target="_blank" rel="noopener">查看 AMIGO 官方基本规则 ↗</a></section></div>`;
}
function tableDecorHTML() {
  return '<div class="table-props" aria-hidden="true"><i class="prop-candle candle-left"></i><i class="prop-candle candle-right"></i><i class="prop-book">✦</i><i class="prop-orb"></i><i class="prop-deck"></i><i class="prop-coins"></i></div>';
}
function render() {
  const previousForesight = $('.foresight-hands');
  const foresightScroll = previousForesight?.scrollTop || 0;
  const foresightFocus = previousForesight?.contains(document.activeElement) ? document.activeElement.id || 'foresight-hands' : null;
  const previousLobby = $('.lobby-table');
  if (previousLobby) lobbyPanelScroll[previousLobby.dataset.activePanel] = previousLobby.scrollTop;
  if ($('#rule-extras')) ruleExtrasOpen = $('#rule-extras').open;
  const tableKey = tableViewKey(state, [roomEpoch,me,isHost,practice,spectating,networkReady,!!pendingSettlement]);
  if (tableKey && tableKey === renderedTableKey && $('.table')) {
    updateSocialRegions(); refreshSelection(); scoreBubbles.mount(app); htmlFrame.request();
    return;
  }
  renderedTableKey = tableKey;
  const container = $('.table')?.getBoundingClientRect();
  document.body.dataset.tableLayout = tableLayoutMode(container?.width || document.documentElement.clientWidth, container?.height || window.innerHeight);
  const previousHand=captureHand($('.hand'));
  const scorePanel = $('#table-score-panel'), ledger = $('.score-ledger .history-scroll');
  const scoreScroll = { top: scorePanel?.scrollTop || 0, left: ledger?.scrollLeft || 0, row: ledger?.scrollTop || 0 };
  if (!state) {
    if (!domestic && automaticName) { nickname = ''; automaticName = false; persistName(); }
    const invitedRoom = parseRoomCode(roomFromURL)?.backendId === backendId() ? parseRoomCode(roomFromURL).room : roomFromURL;
    const returnSession = readRoomSession(sessionStore,invitedRoom);
    const recoveryHandles=readRoomRecoveries(localStore,invitedRoom);
    const returnRooms=returnSession && returnSession.role !== 'practice' ? [{...returnSession,token},...recoveryHandles.filter(r=>r.room!==returnSession.room || r.token!==token)] : recoveryHandles;
    app.innerHTML = shell(`<main class="home-screen">
      <section class="hero home-scene" aria-label="烛光牌桌"><div class="hero-cards">${cardHTML({ kind: 'number', suit: 'blue', rank: 13 })}${cardHTML({ kind: 'wizard' })}${cardHTML({ kind: 'number', suit: 'red', rank: 7 })}</div></section>
      <section class="home-menu" aria-label="主菜单">
        <nav class="entry-context" aria-label="当前线路与游戏大厅"><a href="${gameLobbyURL()}" data-lobby-navigation ${busy ? 'aria-disabled="true"' : ''}>${icon('back')}返回大厅</a><span class="current-route">${backendId() === 'aliyun' ? '阿里云国内' : 'Cloudflare'}</span></nav>
        <div class="home-title"><h1>巫师牌</h1><p class="home-tagline">预估得准，才是赢家。</p></div>
        <div class="menu-identity"><label for="nickname">昵称</label>${domestic ? `<output id="nickname">${escape(nickname)}</output><button type="button" id="random-nickname" ${busy ? 'disabled' : ''}>换一个</button>` : `<input id="nickname" maxlength="16" placeholder="请输入昵称" required autocomplete="nickname" value="${escape(nickname)}">`}</div>
        <p class="home-setup-hint">创建后选择玩法、邀请朋友，3–6 人即可开局。</p>
        <nav class="menu-options" aria-label="开始游戏">
          ${returnRooms.map((r,i)=>`<button ${i===0 ? 'id="resume-room"' : ''} data-return-room="${i}" class="menu-choice">返回 ${escape(r.room)} · ${r.role==='host' ? '房主' : r.role==='spectator' ? '观战' : '玩家'}</button>`).join('')}<button id="create" class="menu-choice menu-primary" ${busy ? 'disabled' : ''}>${busy ? '正在连接…' : '创建房间'}<span class="menu-choice-icon">${icon('cards')}</span></button>
          <button id="join-menu" class="menu-choice" aria-expanded="${joinOpen}" aria-controls="join-form" ${busy ? 'disabled' : ''}>加入房间<span class="menu-choice-icon">${icon('enter')}</span></button>
          <form id="join-form" class="menu-join" ${joinOpen ? '' : 'hidden'}><label class="sr-only" for="room-input">房间码</label><input id="room-input" placeholder="输入房间码" maxlength="24" autocomplete="off" value="${escape(joinDraft ?? (roomFromURL || storedRoom))}"><button id="join" type="submit" ${busy ? 'disabled' : ''}>加入</button></form>
          ${practiceSaved ? '<button id="resume-practice" class="menu-choice">恢复练习<span>↗</span></button>' : ''}<button id="practice" class="menu-choice" ${busy ? 'disabled' : ''}>单人练习<span class="menu-choice-icon">${icon('target')}</span></button>
          ${busy ? '<button id="cancel-connect" class="text-button">取消连接</button>' : ''}
        </nav>
        <div class="home-presence"></div>
        <aside class="home-room-list" aria-label="在线房间"></aside>
      </section></main>`);
    bindCommon();handMotion.attach(null,previousHand,null);
    $('#create').onclick = () => launch(true);
    document.querySelectorAll('[data-return-room]').forEach(button=>button.addEventListener('click',()=>{
      const recovery=returnRooms[Number(button.dataset.returnRoom)];if(!recovery)return;
      token=recovery.token;sessionStore.setItem(tokenKey,token);restoreRoom(recovery);
    }));
    $('#join-form').onsubmit = e => { e.preventDefault(); launch(false); };
    $('#room-input').oninput = e => { joinDraft = e.target.value; };
    $('#join-menu').onclick = () => {
      joinOpen = !joinOpen;
      $('#join-form').hidden = !joinOpen;
      $('#join-menu').setAttribute('aria-expanded', String(joinOpen));
      if (joinOpen) $('#room-input').focus();
    };
    $('#practice').onclick = startPractice;
    $('#resume-practice')?.addEventListener('click', () => restoreRoom(readPractice(localStore)));
    $('#cancel-connect')?.addEventListener('click', () => leaveRoom());
    if (domestic) $('#random-nickname').onclick = () => { selectedNicknameId = randomNicknameId(); nickname = nicknameFromId(selectedNicknameId); persistName(); render(); };
    else $('#nickname').oninput = e => { nickname = e.target.value; automaticName = false; persistName(); };
    return;
  }
  const p = state.players.find(p => p.id === me);
  if (['lobby','roundEnd','finished'].includes(state.phase)) void preloadCardFaces();
  const settlementContext = `${room}:${state.round}:${state.completedTricks}:${state.phase}`;
  if (pendingSettlement && (pendingSettlement.context !== settlementContext || !networkReady && !practice)) pendingSettlement = null;
  const selfIndex = state.players.findIndex(p => p.id === me);
  const context = `${state.round}:${state.completedTricks}:${state.phase}:${state.turn}:${!!state.lifecycle?.paused}:${networkReady}`;
  if (context !== selectionContext) { selectedCard = null; pendingPlay=null; selectionContext = context; }
  if (pendingPlay && (!p?.hand?.some(c=>c.id===pendingPlay.id) || pendingPlay.context!==pendingContext())) pendingPlay=null;
  if (!p?.hand?.some(c => c.id === selectedCard)) selectedCard = null;
  const oldHand = $('.hand'); if (oldHand && oldHand.offsetParent!==null) { if (oldHand.classList.contains('hand-grid')) gridScroll = oldHand.scrollTop; else handScroll = oldHand.scrollLeft; }
  const myTurn = !spectating && state.players[state.turn]?.id === me;
  const hostName = state.players[0]?.name;
  const invitation = practice ? '' : invitationURL(room, spectating);
  if (state.phase === 'lobby' && lobbyPanelRoom !== `${backendId()}:${room}:${me}`) {
    lobbyPanelRoom = `${backendId()}:${room}:${me}`;
    lobbyPanel = isHost ? 'rules' : 'players';
    lobbyPanelScroll = {players:0,rules:0};
    ruleExtrasOpen = false;
  }
  const lobbyTabs = state.phase === 'lobby' ? `<nav class="room-tabs" role="tablist" aria-label="房间设置"><button type="button" id="room-players-tab" role="tab" data-lobby-panel="players" aria-controls="room-players-panel" aria-selected="${lobbyPanel === 'players'}" tabindex="${lobbyPanel === 'players' ? '0' : '-1'}">玩家入座 <span>${state.players.length} / 6</span></button><button type="button" id="room-rules-tab" role="tab" data-lobby-panel="rules" aria-controls="room-rules-panel" aria-selected="${lobbyPanel === 'rules'}" tabindex="${lobbyPanel === 'rules' ? '0' : '-1'}">整局玩法</button></nav>` : '';
  const head = `<div class="room-heading"><div class="room-identity"><span>${practice ? '练习牌桌' : spectating ? '观战房间' : '房间'}</span><span class="room-code">${practice ? '' : escape(publicRoomCode(room))}</span><span class="seat-count">${state.players.length} / 6${!practice ? ` · ${state.spectatorCount || 0} 人观战` : ''}</span></div><div class="room-buttons">${!practice ? `<button id="invite">${spectating ? '分享观战' : '邀请好友'}</button>` : ''}<button id="leave" class="text-button">${spectating ? '退出观战' : '离开'}</button></div>${lobbyTabs}${state.phase === 'lobby' ? `<p class="lobby-current" role="status"><b>当前玩法</b> ${escape(ruleSummary(state.options))}</p>` : ''}</div>`;
  let body;
  if (state.phase === 'lobby') {
    const startHint = state.players.length < 3 ? `还差 ${3 - state.players.length} 人` : state.players.some(p => !p.online) ? '等待玩家重连' : state.options.deckMode === 'mono' && state.players.length > 4 ? '单色限 3–4 人，请选择标准牌库' : '';
    body = `<main class="lobby-table has-rule-setup" data-active-panel="${lobbyPanel}"><div class="hero lobby-scene" aria-hidden="true"><div class="lobby-felt"></div></div><div class="lobby-content">
      <section id="room-players-panel" class="lobby-panel" role="tabpanel" tabindex="0" aria-labelledby="room-players-tab" ${lobbyPanel === 'players' ? '' : 'hidden'}><div class="seats" aria-label="房间座位">${state.players.map((p, i) => `<div class="seat ${p.id === me ? 'my-seat' : ''} ${p.bot ? 'bot-seat' : 'human-seat'} ${!p.online ? 'offline' : ''}"><div class="avatar" aria-hidden="true">${p.bot ? '✧' : escape(p.name.slice(0, 1))}</div><div class="seat-name"><b title="${escape(p.name)}">${escape(p.name)}</b><small>${i === 0 ? '房主' : p.bot ? `${domestic ? '电脑' : '机器人'} · ${p.botDifficulty === 'simple' ? '简单' : '策略'}` : p.online ? '真人' : '真人 · 离线'}${p.id === me ? ' · 你' : ''}</small></div>${isHost && i > 0 ? `<button data-remove="${escape(p.id)}" class="text-button" aria-label="移除${p.bot ? '机器人' : '玩家'} ${escape(p.name)}" title="移除${p.bot ? '机器人' : '玩家'}">×</button>` : ''}</div>`).join('')}${Array.from({ length: 6 - state.players.length }, () => '<div class="seat empty"><div class="avatar" aria-hidden="true">＋</div><div class="seat-name"><b>空位</b><small>等待好友入座</small></div></div>').join('')}</div>
      ${isHost && state.players.length < 6 ? `<div class="lobby-options bot-controls" role="group" aria-label="添加机器人"><label class="sr-only" for="bot-difficulty">机器人难度</label><select id="bot-difficulty"><option value="smart" ${preferredBotDifficulty === 'smart' ? 'selected' : ''}>策略陪练</option><option value="simple" ${preferredBotDifficulty === 'simple' ? 'selected' : ''}>简单陪练</option></select><button id="addbot" type="button">＋ 添加机器人</button></div>` : ''}
      </section><section id="room-rules-panel" class="lobby-panel" role="tabpanel" tabindex="0" aria-labelledby="room-rules-tab" ${lobbyPanel === 'rules' ? '' : 'hidden'}>${ruleSetupHTML(state, isHost, ruleExtrasOpen)}</section>
    </div></main><div class="lobby-controls"><div class="lobby-start">${isHost ? `${startHint ? `<span class="start-hint">${startHint}</span>` : ''}<button id="start" class="primary" ${startHint ? 'disabled' : ''}>开始游戏 →</button>` : `<span class="start-hint">等待 ${escape(hostName)} 开始游戏</span>`}</div></div>`;
  } else {
    const done = ['trickEnd', 'roundEnd', 'finished'].includes(state.phase);
    const roundEnd = ['roundEnd', 'finished'].includes(state.phase);
    const leadOrder = leadInfo(state);

    const matchResult = '';
    const highScore = Math.max(...state.players.map(p => p.score));
    const turnName = escape(state.players[state.turn]?.name);
    const prompt = state.phase === 'finished' ? `${state.players.filter(p => p.score === highScore).map(p => escape(p.name)).join('、')} 赢得本局` : done ? `${escape(state.players[state.lastWinner]?.name)} 赢下这一墩` : state.phase === 'bid' ? (state.canBid ? '预测赢墩' : p?.bidSubmitted ? '等待其他玩家预测' : `等待 ${turnName} 预测`) : myTurn ? ({ trump: '选择本轮主牌', play: '轮到你出牌' }[state.phase]) : `等待 ${turnName} ${state.phase === 'trump' ? '选色' : '出牌'}`;
    const actionUI = state.canBid ? `<div class="bid-options">${state.bids.map(n => `<button class="bid" data-bid="${n}" aria-label="预测赢 ${n} 墩">${n}</button>`).join('')}</div>` : myTurn && state.phase === 'trump' ? `<div class="trump-options">${SUITS.map(s => `<button data-trump="${s}" class="suit-chip ${s}" aria-label="选择${SUIT_NAMES[s]}为主牌">${icon(s)}${SUIT_NAMES[s].split(' · ')[0]}色</button>`).join('')}</div>` : '';
    const foresight = state.foresightActive && !spectating ? `<section id="foresight-hands" class="foresight-hands" tabindex="0" aria-label="先见之明：其他玩家手牌，可上下滚动"><header class="foresight-heading"><b>其他玩家手牌</b><button id="foresight-sort" type="button"></button></header>${state.players.filter(x => x.id !== me).map(x => `<section class="foresight-player" data-foresight-player="${escape(x.id)}" aria-label="${escape(x.name)}的手牌"><h3>${escape(x.name)}<small>${x.count} 张</small></h3><div class="foresight-cards">${sortCards(x.hand || [], foresightSort || handSort).map(c => cardHTML(c)).join('')}</div></section>`).join('')}</section>` : '';
    const currentWinner = state.trick.length ? winner(state.trick, state.trump, state.options.deckMode) : null;
    const followHint = followSuitHint(state, me);
    const settlement = settlementHTML(state, { me, isHost, practice, spectating, pending:!!pendingSettlement });
    body = `<div class="game-layout"><main><div class="roundbar" aria-label="第 ${state.round} 轮，共 ${state.maxRounds} 轮；已完成 ${state.completedTricks} 墩，共 ${state.cardsPerRound} 墩；顺时针出牌"><span>轮 <b>${state.round}</b> / ${state.maxRounds}</span><span class="trick-progress">墩 <b>${state.completedTricks}</b> / ${state.cardsPerRound}</span></div><section class="table">${tableDecorHTML()}<div class="table-ring"></div><div class="opponents" data-count="${state.players.length}" aria-label="围桌席位">${state.players.filter(x => x.id !== me).map(x => {
      const i = state.players.findIndex(y => y.id === x.id), pos = seatPosition(i, selfIndex, state.players.length);
      const identity = `${x.name} · 实赢 ${x.won} · 预测 ${x.bid ?? (x.bidSubmitted ? '已锁定' : '未预测')}${i === state.dealer ? ' · 庄家' : ''}${!x.online ? ' · 离线' : ''}`;
      return `<div class="player ${leadOrder?.seat === i ? 'lead-seat' : ''} ${!x.online ? 'offline' : ''} ${!done && !(state.phase === 'bid' && state.options.predictionMode !== 'public') && state.turn === i ? 'active' : ''}" role="group" aria-label="${escape(identity)}" data-seat="${pos.seat}" data-player="${escape(x.id)}" style="--seat-x:${pos.x}%;--seat-y:${pos.y}%" title="${escape(identity)}">${avatarHTML(x, i, leadOrder?.seat === i ? leadOrder : null)}<span class="seat-name">${escape(domestic ? x.name : shortSeatName(x.name, pos.seat))}${domestic && x.nicknameBadge > 1 ? `<small>#${x.nicknameBadge}</small>` : ''}${domestic && x.bot ? '<small>电脑</small>' : ''}</span><span class="prediction"><span aria-label="实赢 ${x.won} 墩"><small>赢</small><b>${x.won}</b></span><span aria-label="${Number.isInteger(x.bid) ? `预测 ${x.bid} 墩` : x.bidSubmitted ? '预测已锁定，未公开' : '尚未预测'}" class="${Number.isInteger(x.bid) ? '' : 'target-secret'}"><small>估</small><b>${x.bid ?? (x.bidSubmitted ? icon('lock') : '—')}</b></span></span></div>`;
    }).join('')}</div>${foresight}<div class="played-cards ${state.players.length>=5 ? 'compact-trick' : ''}" style="inset:0">${state.trick.map((x, i) => {
      const seat = relativeSeat(x.player, selfIndex, state.players.length);
      const motion = tableMotion.timing(x.card.id);
      return `<div class="played ${currentWinner === x.player ? 'winner' : ''} ${motion.enterMs < CARD_ENTER_MS ? 'card-enter' : ''} ${motion.collectMs !== null ? 'collect-winner' : ''}" role="img" aria-label="${escape(state.players[x.player].name)}：${escape(cardLabel(x.card))}${currentWinner === x.player ? done ? '，赢墩' : '，当前最大' : ''}" data-card-id="${escape(x.card.id)}" data-play-seat="${seat}" data-player="${escape(state.players[x.player].id)}" style="--play-x:50%;--play-y:50%">${cardHTML(x.card)}<small title="${escape(state.players[x.player].name)}"><span class="played-name">${escape(state.players[x.player].name)}</span><span class="played-state" data-compact="${currentWinner===x.player ? done ? '赢墩' : '当前最大' : i===0 ? '首攻' : ''}">${currentWinner === x.player ? done ? '赢墩' : '当前最大' : i===0 ? '首攻' : '&nbsp;'}</span></small></div>`;
    }).join('')}</div>${matchResult}<div class="table-caption">已完成 ${state.completedTricks} / ${state.cardsPerRound} 墩</div></section>${ownStatusHTML(p)}${done ? settlement : `<section class="action-panel"><div class="action-title"><h3>${state.lifecycle?.paused ? '牌局已暂停' : prompt.replace('点击金边手牌出牌', '选牌并确认出牌')}</h3><small class="win-reason">${state.phase === 'bid' ? '' : followHint}</small></div>${actionUI}</section>`}${!spectating ? handHTML(p, myTurn) : ''}</main><aside>${scoreHistoryHTML(state, me)}<section class="panel scoreboard"><div class="section-label">预言排行榜 <span>总分</span></div>${state.players.map((x, i) => ({ ...x, seat: i })).sort((a,b) => b.score - a.score).map((x, i) => { const totals = playerTotals(state, x.id); return `<div class="score-row"><span class="rank">${String(i + 1).padStart(2, '0')}</span><span>${escape(x.name)}${x.id === me ? '<small>你</small>' : ''}<small>胜局 ${totals.matchWins} · 本局赢 ${totals.tricks} 墩 · 猜中 ${totals.exactRounds} 轮</small></span><b>${x.score}</b></div>`; }).join('')}${roundEnd ? `<div class="round-results"><h4>第 ${state.round} 轮得分</h4>${state.history.at(-1).result.map(r => `<div><span>${escape(state.players.find(x => x.id === r.id).name)} <small>${r.won}/${r.bid} 墩</small></span><b class="${r.delta > 0 ? 'positive' : 'negative'}">${r.delta > 0 ? '+' : ''}${r.delta}</b></div>`).join('')}</div>` : ''}</section><section class="panel journal"><div class="section-label">牌桌记事 <span>↙</span></div>${state.log.slice(-7).map(l => `<p>${escape(l)}</p>`).join('')}</section></aside></div>`;
  }
  app.innerHTML = shell(`${head}${body}${lifecycleHTML()}`);
  if (spectating) {
    const banner = document.createElement('div'); banner.className = 'spectator-banner';
    banner.textContent = `观战中 · 仅公开信息 · ${state.spectatorCount || 0} 人观战`;
    $('.page').append(banner);
    $('.hand-section')?.remove();
  }
  bindCommon();
  if ($('.lobby-table')) $('.lobby-table').scrollTop = lobbyPanelScroll[lobbyPanel] || 0;
  document.querySelectorAll('[data-lobby-panel]').forEach(button => {
    const activate = panel => { lobbyPanel = panel; render(); $(`[data-lobby-panel="${panel}"]`)?.focus({preventScroll:true}); };
    button.addEventListener('click', () => activate(button.dataset.lobbyPanel));
    button.addEventListener('keydown', event => {
      if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
      event.preventDefault();
      activate(event.key === 'Home' ? 'players' : event.key === 'End' ? 'rules' : button.dataset.lobbyPanel === 'players' ? 'rules' : 'players');
    });
  });
  if ($('#table-score-panel')) $('#table-score-panel').scrollTop = scoreScroll.top;
  const updatedLedger = $('.score-ledger .history-scroll');
  if (updatedLedger) { updatedLedger.scrollLeft = scoreScroll.left; updatedLedger.scrollTop = scoreScroll.row; }
  handMotion.attach($('.hand'),previousHand,selectedCard);
  $('#invite')?.addEventListener('click', async () => {
    if (await copyInvitation(invitation)) notify('邀请链接已复制，发给朋友吧。');
  });
  $('#leave').onclick = requestLeave;
  $('#room-pause')?.addEventListener('click', () => roomControl(state.lifecycle?.paused ? 'resume' : 'pause'));
  const dissolve = () => { if (confirm('解散后所有成员会收到通知，旧链接无法恢复。确定解散房间？')) { if (practice) { localStore.removeItem(PRACTICE_SAVE_KEY); leaveRoom('练习已解散。', false, false); } else roomControl('dissolve'); } };
  $('#room-dissolve')?.addEventListener('click', dissolve);
  $('#finished-dissolve')?.addEventListener('click', dissolve);
  $('#continue-yes')?.addEventListener('click', () => roomControl('continuationVote', {accept:true}));
  $('#continue-no')?.addEventListener('click', () => roomControl('continuationVote', {accept:false}));
  $('#confirm-results')?.addEventListener('click', () => submitSettlement('confirmResults'));
  bindHand();
  refreshForesightSort();
  if ($('.foresight-hands')) {
    layoutSchedule.flush();
    $('.foresight-hands').scrollTop = foresightScroll;
    if (foresightFocus) document.getElementById(foresightFocus)?.focus({preventScroll:true});
  }
  const selectedOptions = () => Object.fromEntries([...$('#rules-form').querySelectorAll('input:checked')].map(input => [input.name, ['true', 'false'].includes(input.value) ? input.value === 'true' : input.value]));
  $('#rules-form')?.addEventListener('change', () => send({ type: 'configure', options: selectedOptions() }));
  $('#rules-form')?.addEventListener('submit', event => { event.preventDefault(); if (isHost) send({ type: 'start', options: selectedOptions() }); });
  $('#start')?.addEventListener('click', () => send({ type: 'start', options: selectedOptions() }));
  $('#bot-difficulty')?.addEventListener('change', event => { preferredBotDifficulty = event.target.value; });
  $('#addbot')?.addEventListener('click', () => {
    if (!practice) return roomControl('addbot',{difficulty:$('#bot-difficulty')?.value || 'smart'});
    try { const id=uuidV4();addPlayer(game, id, '', true, true);game.players.find(p=>p.id===id).botDifficulty=$('#bot-difficulty')?.value || 'smart'; broadcast(); } catch (error) { notify(error.message); }
  });
  document.querySelectorAll('[data-remove]').forEach(b => b.onclick = () => {
    if (!isHost || state.phase !== 'lobby') return;
    if (!practice) return roomControl('remove', {id:b.dataset.remove});
    game.players = game.players.filter(p => p.id !== b.dataset.remove); broadcast();
  });
  document.querySelectorAll('[data-bid]').forEach(b => b.onclick = () => send({ type: 'bid', value: Number(b.dataset.bid) }));
  document.querySelectorAll('button[data-trump]').forEach(b => b.onclick = () => send({ type: 'trump', suit: b.dataset.trump }));

  $('#next')?.addEventListener('click', () => submitSettlement('next'));
  $('#rematch')?.addEventListener('click', () => submitSettlement('rematch'));
}
function bindCommon() {
  const pregame = state && ['lobby', 'rules'].includes(state.phase);
  document.body.dataset.phase = state?.phase || '';
  document.body.dataset.foresight = String(!!state?.foresightActive && !spectating);
  document.body.dataset.screen = !state ? 'home' : pregame ? 'lobby' : 'game';
  document.body.dataset.connection = !state ? 'home' : practice || networkReady ? 'connected' : 'reconnecting';
  document.body.dataset.spectator = String(spectating);
  if (!state) {
    const badge = document.createElement('span');
    badge.id = 'online-count';
    badge.setAttribute('role', 'status');
    badge.title = '当前网站已连接的浏览器数（含牌局中玩家），同一浏览器多个标签页合并。断网或手机后台挂起时，离线检测可能延迟。';
    document.querySelector('.home-presence').append(badge);
    updateOnlineCount();
    directory.mount($('.home-room-list'));
  }
  const graphics = document.createElement('button');
  graphics.id = 'graphics'; graphics.className = 'text-button graphics-toggle';
  $('.top-actions').prepend(graphics);
  graphics.onclick = () => { if (tableScene) { tableScene.setLow(!tableScene.low); updateGraphicsButton(); } };
  const motion = document.createElement('button');
  motion.id = 'trump-motion'; motion.className = 'text-button';
  $('.top-actions').append(motion);
  motion.onclick = () => {
    trumpMotionPreference = String(document.body.dataset.trumpMotion !== 'on');
    localStore.setItem('wizard-trump-motion', trumpMotionPreference);
    updateTrumpMotion();
  };
  updateTrumpMotion();
  const soundButton = document.createElement('button'); soundButton.id = 'turn-sound'; soundButton.textContent = `行动提示音：${turnSound ? '开' : '关'}`;
  $('.top-actions').append(soundButton); soundButton.onclick = () => { turnSound = !turnSound; localStore.setItem('wizard-turn-sound', String(turnSound)); soundButton.textContent = `行动提示音：${turnSound ? '开' : '关'}`; };
  if (state && !pregame) setupGameHUD(graphics);
  music.mount(state && !pregame ? $('#table-menu-panel') : $('.top-actions'));
  // Only the trigger enters the waiting-room footer; the persistent panel
  // stays under its social root to retain visual-viewport keyboard handling.
  if (social.chatButton) social.dock.append(social.chatButton);
  social.update(state, me, pregame ? $('.room-buttons') : $('.game-toolbar'), { connected: practice || (networkReady && seenEventSeq != null), room });
  if (state) {
    const ops = document.createElement('nav'); ops.className = 'room-operations'; ops.setAttribute('aria-label', '房间操作');
    ops.innerHTML = `${isHost && !spectating ? `<button id="room-pause">${state.lifecycle?.paused ? '恢复' : '暂停'}</button>` : ''}<button id="room-leave-placeholder"></button>${isHost && !spectating ? '<button id="room-dissolve" class="danger">解散房间</button>' : ''}`;
    ops.querySelector('#room-leave-placeholder').replaceWith($('#leave'));
    if (!pregame && ops.querySelector('#room-pause')) {
      const pause = ops.querySelector('#room-pause');
      pause.setAttribute('aria-label',state.lifecycle?.paused ? '恢复牌局' : '暂停牌局');
      pause.title = state.lifecycle?.paused ? '恢复牌局' : '暂停牌局';
      setIconButton(pause, state.lifecycle?.paused ? 'play' : 'pause', state.lifecycle?.paused ? '继续' : '暂停', state.lifecycle?.paused ? '恢复牌局' : '暂停牌局');
      $('.game-toolbar').prepend(pause);
    }
    (pregame ? $('.room-heading') : $('#table-menu-panel')).append(ops);
    if (pregame && $('.lifecycle-banner')) $('.room-heading').append($('.lifecycle-banner'));
  }
  if (!domestic) $('#chat-form').hidden = spectating;
  if (!domestic && spectating) { $('#rename-toggle')?.remove(); $('#rename-panel').hidden = true; }
  if (state && !pregame) {
    if ($('#rename-toggle')) $('#table-menu-panel')?.append($('#rename-toggle'));
    if (social.chatButton) $('.game-toolbar')?.prepend(social.chatButton);
  }
  setupClearUI();
  if (pregame) {
    if ($('.lobby-controls')) $('.topbar').append($('.lobby-controls'));
    if (social.chatButton) $('.topbar').append(social.chatButton);
  }
  if (state) {
    const ownPlayer = state.players.find(p => p.id === me);
    if (ownPlayer) { if (domestic) selectedNicknameId = ownPlayer.nicknameId; nickname = ownPlayer.name; automaticName = !!ownPlayer.automaticName; persistName(); }
    const table = $('.table');
    if (table) renderTrumpDisplay(table, state);
    if ((!practice && !networkReady) || state.lifecycle?.paused || state.lifecycle?.continuationVote) {
      document.querySelectorAll('#start, #rules-form input, #addbot, [data-remove], [data-bid], [data-trump], #confirm-play, #next, #rematch').forEach(control => { control.disabled = true; });
    }
    // Social controls survive render(), so they must also be re-enabled after recovery.
    document.querySelectorAll('#chat-input, #chat-form button, #rename-input, #rename-form button').forEach(control => { control.disabled = spectating || (!practice && !networkReady); });
  }
  updateSpectatorActivity();
  document.body.dataset.paused = String(!!state?.lifecycle?.paused);
  const handCount = state?.players.find(player => player.id === me)?.count ?? 0;
  document.body.style.setProperty('--hand-count', String(Math.max(1, handCount)));
  document.body.style.setProperty('--fan-height', `${handCount <= 5 ? 216 : handCount <= 15 ? 204 : 194}px`);
  document.body.classList.toggle('hand-expanded', handExpanded && !handCollapsed);
  document.body.classList.toggle('hand-collapsed', handCollapsed);
  layoutSchedule.request({force:true});
  tableLayoutObserver.disconnect();
  const observed = '.table,.own-status,.action-panel,.hand-section,.concealed-hand' + (state?.foresightActive ? ',.opponents .player,.foresight-heading,.trump-display' : '');
  document.querySelectorAll(observed).forEach(node=>tableLayoutObserver.observe(node));
  syncScene(); updateGraphicsButton();
  if (trumpReveal.effect && !trumpReveal.root) layoutSchedule.flush();
  let deckRect = null;
  if (trumpReveal.effect?.type === 'reveal' && !trumpReveal.root) {
    const deck = $('.prop-deck');
    deckRect = document.body.classList.contains('has-webgl') ? tableScene?.deckScreenRect()
      : deck?.offsetWidth && getComputedStyle(deck).visibility !== 'hidden' ? deck.getBoundingClientRect() : null;
  }
  trumpReveal.mount($('.table'), deckRect);
  cacheHTMLCards();
  document.querySelectorAll('.played').forEach(played => {
    const label = document.createElement('span');
    label.className = 'played-value';
    label.textContent = played.querySelector('.card')?.getAttribute('aria-label') || '';
    played.querySelector(':scope > small')?.append(label);
  });
  decorateHand();
  scoreBubbles.mount(app);
  $('#rules').onclick = () => setRulesOpen(true);
  $('#close-rules')?.addEventListener('click', () => setRulesOpen(false));
}
function setRulesOpen(open) {
  if (open) floatingLayers.closeOthers(null);
  rulesOpen = open;
  if (open) {
    if (!$('#close-rules')) app.insertAdjacentHTML('beforeend', rulesHTML());
    $('#close-rules').onclick = () => setRulesOpen(false);
    $('#close-rules').focus();
  } else {
    $('#close-rules')?.closest('.modal-backdrop')?.remove();
    const trigger = $('#rules')?.getClientRects().length ? $('#rules') : $('#table-menu') || $('#quick-settings > summary');
    trigger?.focus({preventScroll:true});
  }
}
function updateSocialRegions() {
  social.update(state, me, $('.game-toolbar'), {connected:practice || (networkReady && seenEventSeq != null),room});
  if ($('#rename-toggle')) {
    if (spectating) $('#rename-toggle').remove();
    else $('#table-menu-panel')?.append($('#rename-toggle'));
  }
  updateSpectatorActivity();
  const journal = $('.journal'), key = JSON.stringify(state.log.slice(-7));
  if (journal && key !== renderedJournal) {
    renderedJournal = key;
    journal.innerHTML = `<div class="section-label">牌桌记事 <span>↙</span></div>${state.log.slice(-7).map(line => `<p>${escape(line)}</p>`).join('')}`;
  }
  updateCountdown();
}
// The node list changes only when a game view changes, never on an idle frame.
let htmlCards = [], htmlLinks = null;
const htmlFrame = frameScheduler.add(frameTime => {
  if (document.hidden) return null;
  if (trumpReveal.effect || trumpReveal.pulseAt !== null) trumpReveal.draw();
  const sample = tableMotion.snapshot(frameTime);
  drawHTMLCards(sample);
  const revealDelay = trumpReveal.nextUpdateDelay();
  const delays = [sample.nextDelay, revealDelay, scoreBubbles.draw()].filter(delay => delay !== null);
  return delays.length ? Math.min(...delays) : null;
});
function cacheHTMLCards() {
  htmlLinks = $('.played-links');
  htmlCards = [...document.querySelectorAll('.played[data-card-id]')].map(node => ({
    node, card:node.querySelector('.card'), label:node.querySelector(':scope > small'), id:node.dataset.cardId,
  }));
  htmlFrame.request();
}
function drawHTMLCards(sample = tableMotion.snapshot()) {
  if (!state?.trick.length || document.hidden) return;
  const labelOpacity = String(sample.labelOpacity);
  if (htmlLinks && htmlLinks.style.opacity !== labelOpacity) htmlLinks.style.opacity = labelOpacity;
  const webgl = document.body.classList.contains('has-webgl');
  for (const {node,card,label,id} of htmlCards) {
    if (node.style.getPropertyValue('--played-label-opacity') !== labelOpacity) node.style.setProperty('--played-label-opacity', labelOpacity);
    if (label) {
      if (label.style.opacity !== labelOpacity) label.style.opacity = labelOpacity;
      const visibility = sample.labelOpacity === 0 ? 'hidden' : '';
      if (label.style.visibility !== visibility) label.style.visibility = visibility;
    }
    if (webgl || !card) continue;
    const pose = sample.poses.get(id);
    if (!pose) continue;
    const offset = name => parseFloat(node.style.getPropertyValue(name)) || 0;
    const x = offset('--from-x') * (1 - pose.enter) + offset('--winner-dx') * pose.collect;
    const y = offset('--from-y') * (1 - pose.enter) + offset('--winner-dy') * pose.collect - pose.lift;
    const transform = `translate(${x}px, ${y}px) scale(${pose.scale})`;
    const opacity = String(pose.enter * pose.opacity);
    if (card.style.transform !== transform) card.style.transform = transform;
    if (card.style.opacity !== opacity) card.style.opacity = opacity;
  }
}
function updateLayoutMetrics(force = false) {
  const changed=updateTableLayout({state,me,tableMotion,reducedMotion:motionMedia.matches,drawHTMLCards:() => htmlFrame.request(),force});
  // Reuse the existing layout scheduler/observer. Details must fit above the
  // actual result dock after rotation, wrapping names or browser chrome changes.
  const dock=$('.settlement-panel');
  if(dock){const top=`${Math.max(0,dock.getBoundingClientRect().top)}px`;if(dock.style.getPropertyValue('--settlement-dock-top')!==top)dock.style.setProperty('--settlement-dock-top',top);}
  return changed;
}
function setupClearUI() {
  if (!state || ['lobby', 'rules'].includes(state.phase)) {
    const settings = document.createElement('details');
    settings.id = 'quick-settings'; settings.open = settingsOpen;
    settings.innerHTML = '<summary>设置</summary><div class="settings-content"></div>';
    const content = settings.querySelector('.settings-content');
    $('.top-actions').append(settings);
    for (const selector of ['#graphics', '#music-toggle', '#trump-motion', '#turn-sound', ...(state ? ['#rules', '#rename-toggle'] : [])]) {
      const el = $(selector); if (el) content.append(el);
    }
    content.insertAdjacentHTML('beforeend', screenDirectionControlHTML + lobbyNavigationHTML());
    if (state) $('.room-identity')?.insertAdjacentHTML('beforeend', `<a class="room-lobby-link" href="${gameLobbyURL()}" data-lobby-navigation>返回游戏大厅 ↗</a>`);
    settings.ontoggle = () => {
      if (!settings.isConnected) return;
      settingsOpen = settings.open;
      if (settings.open) floatingLayers.closeOthers('settings');
    };
  } else {
    $('.action-panel')?.classList.toggle('your-action', state.phase === 'bid' ? state.canBid : state.players[state.turn]?.id === me && ['play', 'trump'].includes(state.phase));
    const active = $('.player.active');
    if (active) {
      const badge = document.createElement('span'); badge.className = 'turn-label';
      badge.innerHTML = `${icon(state.phase === 'play' ? 'play' : 'target')}${state.phase === 'play' ? '出牌' : state.phase === 'bid' ? '预测' : '选色'}`; active.append(badge);
    }
    const journal = $('.journal');
    const details = document.createElement('details'); details.className = 'journal-details';
    details.innerHTML = '<summary>对局记录</summary>'; journal.replaceWith(details); details.append(journal);
    const settlement = $('.settlement-details');
    if (settlement) settlement.ontoggle = () => { if (settlement.isConnected && settlement.open) floatingLayers.closeOthers('settlement'); };
    if (state.phase === 'play' && !$('#turn-countdown')) {
      const timer = document.createElement('span'); timer.id = 'turn-countdown';
      timer.setAttribute('role', 'timer');
      $('.action-panel').prepend(timer);
      updateCountdown();
    }
    updateCountdown();
  }
}
function updateCountdown() {
  if (!state) return;
  const text = (node,value) => { if (node.textContent !== value) node.textContent = value; };
  const retentionTimer = $('#retention-countdown');
  if (retentionTimer) {
    const seconds = Math.max(0, Math.ceil((state.lifecycle.retentionDeadline - Date.now() - serverClockOffset) / 1000));
    text(retentionTimer, seconds ? `剩余 ${Math.floor(seconds / 3600)} 小时 ${Math.floor(seconds % 3600 / 60)} 分 ${seconds % 60} 秒` : '保留期限已到，等待服务器处理');
  }
  const voteTimer = $('#continuation-countdown'); if (voteTimer) text(voteTimer,`${Math.max(0,Math.ceil((state.lifecycle.continuationVote.deadline - Date.now() - serverClockOffset)/1000))} 秒`);
  const review = $('#trick-review-timer');
  if (review) {
    const ms = state.lifecycle?.paused ? state.lifecycle.reviewRemainingMs : state.lifecycle?.nextTrickAt - Date.now() - serverClockOffset;
    text(review,state.lifecycle?.paused ? '已暂停' : `${Number.isFinite(ms) ? Math.max(0, Math.ceil(ms / 1000)) : '…'}s · 下一墩`);
  }
  const timer = $('#turn-countdown');
  if (!timer) return;
  const status = turnStatus(state, { now: Date.now() + serverClockOffset, connected: practice || networkReady });
  const content = `${icon(state.lifecycle?.paused ? 'pause' : state.lifecycle?.reconnecting || !practice && !networkReady ? 'reconnect' : 'clock')}<span>${escape(status.text.replace(' 秒', 's').replace('断线等待 ', '重连 ').replace('连接恢复中', '重连中'))}</span>`;
  if (timer.innerHTML !== content) timer.innerHTML = content;
  timer.title = '每次出牌 45 秒；断线累计最多冻结 20 秒，重连至少保留 10 秒（本次出牌最多补 10 秒）；超时自动合法出牌';
  timer.classList.toggle('urgent', status.urgent);
  const label = status.label ?? status.text;
  if (timer.getAttribute('aria-label') !== label) timer.setAttribute('aria-label', label);
}
function setupGameHUD(graphics) {
  const toolbar = document.createElement('nav');
  toolbar.className = 'game-toolbar'; toolbar.setAttribute('aria-label', '对局工具');
  toolbar.innerHTML = '<button id="table-scores" aria-controls="table-score-panel"></button><button id="table-menu" aria-controls="table-menu-panel"></button>';
  setIconButton(toolbar.querySelector('#table-scores'), 'scores', '记分', '计分表与玩家信息');
  setIconButton(toolbar.querySelector('#table-menu'), 'menu', '菜单', '菜单与设置');
  $('.page').append(toolbar);
  const menu = document.createElement('section');
  menu.id = 'table-menu-panel'; menu.className = 'table-menu-panel';
  const title = document.createElement('p');
  title.textContent = practice ? '离线练习' : `房间 ${room}`; menu.append(title);
  const resultInfo = document.createElement('p');
  resultInfo.className = 'menu-result-info';
  resultInfo.textContent = '预测命中：20 + 10 × 实赢；未中：每差 1 墩扣 10 分。轮末动画结束后自动发牌；有玩家离线时等待重连。';
  menu.append(resultInfo);
  const reason = winnerReason(state.trick, state.trump, state.options.deckMode);
  if (reason) { const detail = document.createElement('p'); detail.textContent = reason; menu.append(detail); }
  const selectedRules = document.createElement('p');
  selectedRules.className = 'current-rules'; selectedRules.textContent = ruleSummary(state.options); menu.append(selectedRules);
  for (const el of [$('#rules'), graphics, $('#trump-motion'), $('#turn-sound'), $('#invite')]) if (el) menu.append(el);
  menu.insertAdjacentHTML('beforeend', screenDirectionControlHTML + lobbyNavigationHTML());
  const handTools = $('.hand-heading');
  if (handTools) { handTools.className = 'hand-tools'; handTools.setAttribute('aria-label', '手牌工具'); $('.page').append(handTools); }
  refreshHandControls();
  $('.page').append(menu);
  const scores = $('.game-layout aside'); scores.id = 'table-score-panel';
  const close = document.createElement('button');
  close.className = 'close-scores'; setIconButton(close, 'close', '关闭', '关闭计分表'); scores.prepend(close);
  menu.setAttribute('aria-label', '菜单与设置');
  scores.setAttribute('aria-label', '计分表与玩家信息');
  $('#table-menu').onclick = () => { floatingLayers.closeOthers('menu'); menuOpen = !menuOpen; updateFloatingHUD(); };
  $('#table-scores').onclick = () => {
    floatingLayers.closeOthers('scores'); scoresOpen = !scoresOpen; scoreSource = null; updateFloatingHUD();
  };
  close.onclick = () => closeScores(true);
  document.querySelectorAll('[data-player-details]').forEach(avatar => avatar.onclick = () => {
    floatingLayers.closeOthers('scores');
    scoresOpen = !(scoresOpen && scoreSource === avatar.dataset.playerDetails);
    scoreSource = avatar.dataset.playerDetails;
    updateFloatingHUD();
    if (scoresOpen) close.focus({preventScroll:true});
  });
  updateFloatingHUD();
}
function updateFloatingHUD() {
  if ($('#table-menu-panel')) $('#table-menu-panel').hidden = !menuOpen;
  if ($('#table-score-panel')) $('#table-score-panel').hidden = !scoresOpen;
  $('#table-menu')?.setAttribute('aria-expanded', String(menuOpen));
  $('#table-scores')?.setAttribute('aria-expanded', String(scoresOpen));
  document.querySelectorAll('[data-player-details]').forEach(avatar => {
    avatar.setAttribute('aria-expanded', String(scoresOpen && scoreSource === avatar.dataset.playerDetails));
  });
}
function closeScores(restoreFocus = false) {
  scoresOpen = false; updateFloatingHUD();
  if (restoreFocus) {
    const source = scoreSource && [...document.querySelectorAll('[data-player-details]')].find(avatar => avatar.dataset.playerDetails === scoreSource);
    (source || $('#table-scores'))?.focus({preventScroll:true});
  }
}
document.addEventListener('keydown', e => { if (e.key === 'Escape' && rulesOpen) setRulesOpen(false); });
function saveName() {
  if (domestic) { nickname = nicknameFromId(selectedNicknameId); persistName(); return !!nickname; }
  try {
    if (!nickname.trim()) throw new Error('请先填写昵称。');
    nickname = validateName(nickname); automaticName = false; persistName(); return true;
  } catch (error) { notify(error.message); $('#nickname')?.focus(); return false; }
}

function updateSpectatorActivity() {
  const active = spectating && state && !['lobby', 'rules'].includes(state.phase);
  spectatorActivity.hidden = !active;
  if (!active) { spectatorActivity.querySelector('ol').replaceChildren(); return; }
  const list = spectatorActivity.querySelector('ol');
  if (spectatorActivity.dataset.room !== room) { list.replaceChildren(); spectatorActivity.dataset.room = room; }
  const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 45;
  const events = state.publicEvents?.length ? state.publicEvents : state.log.map((text, index) => ({ seq: `log-${state.round}-${index}`, text }));
  const retained = new Set(events.map(event => String(event.seq)));
  for (const row of [...list.children]) if (!retained.has(row.dataset.seq)) row.remove();
  const existing = new Map([...list.children].map(row => [row.dataset.seq, row]));
  for (const event of events) {
    let row = existing.get(String(event.seq));
    if (!row) { row = document.createElement('li'); row.dataset.seq = String(event.seq); list.append(row); }
    if (row.textContent !== event.text) row.textContent = event.text;
  }
  if (atBottom) list.scrollTop = list.scrollHeight;
}
function persistRoom() {
  if (!room || !me) return;
  const saved = practice ? { role: 'practice', room, me, game, identities, collection:practiceCollection, paused:practicePaused, remainingMs:practicePaused ? practiceRemaining : Number.isFinite(game.turnDeadline) ? Math.max(0,game.turnDeadline-Date.now()) : null } : { role: isHost ? 'host' : spectating ? 'spectator' : 'guest', authoritative: true, room, me, state };
  if (practice) savePractice(localStore, {...saved,paused:practicePaused});
  else saveRoomRecovery(localStore,{room,me,token,role:saved.role});
  if (!saveRoomSession(sessionStore, saved)) notify('浏览器存储不可用，刷新后可能无法恢复牌局。');
}
function stopRoomTransport() {
  roomEpoch++;
  trumpReveal.finish();
  scoreBubbles.finish();
  const previous = transport;
  transport = null;
  clearTimeout(botTimer); clearTimeout(turnTimer);
  previous?.stop();
}

function leaveRoom(message = '', announce = true, keep = true) {
  if (announce && !practice) transport?.send({type:'leave'});
  if (practice && keep && game) {
    const saved = {role:'practice',room,me,game,identities,collection:practiceCollection,paused:practicePaused,remainingMs:practicePaused ? practiceRemaining : Math.max(0,game.turnDeadline-Date.now()),leftAt:Date.now()};
    savePractice(localStore,saved,Date.now(),true);saveRoomSession(sessionStore,saved);
  }
  const previous = transport;
  roomEpoch++; transport = null; clearTimeout(botTimer); clearTimeout(turnTimer);
  trumpReveal.finish();
  scoreBubbles.finish();
  previous?.stop();
  if (!keep) { clearRoomSession(sessionStore); if (!practice) removeRoomRecovery(localStore,room,token); }
  game = state = undefined; room = me = ''; identities = {};
  isHost = practice = spectating = networkReady = busy = false;
  scoresOpen = menuOpen = rulesOpen = settingsOpen = false; scoreSource = null;
  selectedCard = null; pendingPlay=null;pendingSettlement=null;seenEventSeq = null;
  practiceSaved = readPractice(localStore); handExpanded = false;handCollapsed=false;
  history.replaceState(null, '', location.pathname);
  notify(message); render();
}
function roomDepartureText() {
  const life = state.lifecycle || {};
  if (spectating) return '这会退出观战，不会解散房间。';
  if (practice) return '这会暂离练习，不会解散；练习在原浏览器保留 10 分钟，暂停不延长。';
  const deadline = life.retentionDeadline ? `现有截止 ${new Date(life.retentionDeadline).toLocaleString('zh-CN', {hour12:false})}。` : '';
  const retention = life.continuationVote ? '当前续赛投票继续按原截止处理，离开不撤销投票。'
    : life.closeAfterRound ? '仅完成当前轮，结果确认或展示到期后关闭。'
    : isHost ? `房主最后一个有效连接离线后${life.paused ? '保留最多 4 小时；同次暂停首次离线固定截止，重连不顺延。' : '保留 30 分钟。'}${deadline}到期符合条件时先发起 60 秒当前轮续赛投票，否则关闭。`
    : `房间期限由房主在线和暂停状态决定。${deadline}到期符合条件时先发起 60 秒当前轮续赛投票，否则关闭。`;
  return `这会暂离房间，不会解散；座位与原身份保留。${retention}使用原浏览器返回当前游戏网址可恢复，房间码 ${room}。`;
}
function requestLeave() {
  if (confirm(`${roomDepartureText()}确定离开？`)) leaveRoom('已离开，可从原浏览器返回恢复。');
}
function lobbyNavigationHTML() {
  return `<div class="lobby-navigation"><button type="button" data-lobby-navigation ${busy && !state ? 'disabled' : ''}>返回游戏大厅</button></div>`;
}

document.addEventListener('click', event => {
  const control = event.target.closest?.('[data-lobby-navigation]');
  if (!control) return;
  event.preventDefault();
  if (control.disabled || busy && !state) return;
  if (state) {
    if (!confirm(`返回游戏大厅？${roomDepartureText()}`)) return;
    persistRoom(); leaveRoom();
  }
  location.assign(gameLobbyURL());
});

function roomControl(type, extra = {}) {
  if (!practice) { if (!networkReady) return notify('连接恢复中，请稍候。'); return transport?.send({type,...extra}); }
  if (type === 'pause') {
    syncPracticeCollection();
    if (practiceCollection) practiceCollection.remainingMs = Math.max(0, practiceCollection.at - Date.now());
    practicePaused = true; practiceRemaining = Number.isFinite(game.turnDeadline) ? Math.max(0,game.turnDeadline-Date.now()) : null;
    clearTimeout(botTimer); clearTimeout(turnTimer); broadcast();
  } else if (type === 'resume') {
    if (practiceCollection && Number.isFinite(practiceCollection.remainingMs)) {
      practiceCollection.at = Date.now() + practiceCollection.remainingMs;
      practiceCollection.remainingMs = null;
    }
    practicePaused = false; if (Number.isFinite(practiceRemaining) && game.phase === 'play') game.turnDeadline = Date.now() + practiceRemaining; broadcast();
  }
}
function submitSettlement(type) {
  const context = `${room}:${state.round}:${state.completedTricks}:${state.phase}`;
  if (pendingSettlement?.context === context) return;
  const requestId = uuidV4();
  pendingSettlement = {context,requestId};
  const sent = type === 'confirmResults' ? roomControl(type, {requestId}) : send({type}, requestId);
  if (!sent) pendingSettlement = null;
  render();
}
function decorateHand() {
  const hand = $('.hand');
  if (hand) {
    const cards = [...hand.querySelectorAll('.card')], total = cards.length;
    hand.classList.toggle('large-hand', total > 9 || (matchMedia('(max-width: 580px)').matches && total > 5));
    cards.forEach((card, i) => {
      const offset = i - (total - 1) / 2;
      card.style.setProperty('--fan', `${offset * Math.min(3.2, 25 / Math.max(total,1))}deg`);
      card.style.setProperty('--lift', `${(total > 1 ? offset / ((total - 1) / 2) : 0) ** 2 * 4}px`);
      card.style.setProperty('--order', i);
    });
  }
}
function refreshSelection() {
  const card = state?.players.find(player => player.id === me)?.hand?.find(card => card.id === selectedCard);
  const reason = pendingPlay ? '正在提交，等待房间确认' : card ?
    (!networkReady && !practice ? '连接恢复中，重新连接后再选择' : playBlockedReason(state, me, card)) : '';
  updateHandSelection(app, {id:selectedCard,card,label:card ? cardLabel(card) : '',faceHTML:cardHTML,reason,pending:pendingPlay});
  handMotion.selected = selectedCard;
  handMotion.layout();
}
function refreshHand({sort = false} = {}) {
  const hand = $('.hand');
  if (!hand) return;
  const previous = captureHand(hand);
  if (hand.classList.contains('hand-grid')) gridScroll = hand.scrollTop;
  else handScroll = hand.scrollLeft;
  if (sort) reorderHand(hand, sortCards(state.players.find(p => p.id === me)?.hand || [], handSort).map(card => card.id));
  hand.classList.toggle('hand-grid', handExpanded); hand.classList.toggle('hand-strip', !handExpanded);
  const section = $('.hand-section');
  section.classList.toggle('expanded', handExpanded); section.classList.toggle('collapsed', handCollapsed);
  document.body.classList.toggle('hand-expanded', handExpanded && !handCollapsed);
  document.body.classList.toggle('hand-collapsed', handCollapsed);
  refreshHandControls();
  decorateHand();
  handMotion.attach(hand, previous, selectedCard);
  hand.scrollLeft = handExpanded ? 0 : handScroll; hand.scrollTop = handExpanded ? gridScroll : 0;
  refreshSelection();
  layoutSchedule.request();
}
function refreshHandControls() {
  const collapse = $('#hand-collapse'), expand = $('#hand-expand'), sort = $('#hand-sort');
  if (!collapse || !expand || !sort) return;
  setIconButton(collapse, handCollapsed ? 'up' : 'down', handCollapsed ? '手牌' : '收起', handCollapsed ? '显示手牌' : '收起手牌');
  collapse.setAttribute('aria-expanded', String(!handCollapsed));
  setIconButton(sort, 'sort', handSort === 'suit' ? '花色' : '点数', `手牌按${handSort === 'suit' ? '花色' : '点数'}排序，切换为${handSort === 'suit' ? '点数' : '花色'}排序`);
  setIconButton(expand, handExpanded ? 'fan' : 'expand', handExpanded ? '扇形' : '展开', handExpanded ? '收起展开手牌' : '展开全部手牌');
  expand.setAttribute('aria-expanded', String(handExpanded));
}
function bindHand() {
  const hand = $('.hand');
  if (hand) {
    hand.scrollLeft = handExpanded ? 0 : handScroll; hand.scrollTop = handExpanded ? gridScroll : 0;
    let start = null, dragged = false;
    hand.onpointerdown = event => { start = {x:event.clientX,y:event.clientY}; dragged = false; };
    hand.onpointermove = event => { if (start && isSwipe(start,{x:event.clientX,y:event.clientY})) dragged = true; };
    hand.onpointercancel = () => { dragged = true; };
    hand.onclick = event => {
      const card = event.target.closest('[data-card]'); if (!card || dragged) { dragged = false; return; }
      if (pendingPlay) return;
      selectedCard = card.dataset.card; refreshSelection();
    };
    hand.onscroll = () => { if (handExpanded) gridScroll = hand.scrollTop; else handScroll = hand.scrollLeft; };
  }
  if ($('#hand-expand')) $('#hand-expand').onclick = () => {handCollapsed=false;handExpanded=!handExpanded;refreshHand();};
  if ($('#hand-collapse')) $('#hand-collapse').onclick = () => {handCollapsed=!handCollapsed;refreshHand();};
  if ($('#hand-sort')) $('#hand-sort').onclick = () => {handSort=handSort==='suit' ? 'rank' : 'suit';sessionStore.setItem('wizard-hand-sort',handSort);refreshHand({sort:true});refreshForesightSort();};
  if ($('#foresight-sort')) $('#foresight-sort').onclick = () => {
    foresightSort = (foresightSort || handSort) === 'suit' ? 'rank' : 'suit';
    sessionStore.setItem('wizard-foresight-sort', foresightSort);
    refreshForesightSort();
  };
  if ($('#confirm-play')) $('#confirm-play').onclick = () => {
    const card = state.players.find(p => p.id === me)?.hand?.find(c => c.id === selectedCard);
    if (pendingPlay || !card || !practice && !networkReady || playBlockedReason(state,me,card)) return;
    const id=selectedCard; pendingPlay={id,context:pendingContext(),requestId:uuidV4()};
    refreshSelection();
    if (!send({type:'play',card:id},pendingPlay.requestId)) pendingPlay=null;
    refreshSelection();
  };
}
function refreshForesightSort() {
  const panel = $('.foresight-hands'), button = $('#foresight-sort');
  if (!panel || !button || !state?.foresightActive) return;
  const mode = foresightSort || handSort, label = mode === 'suit' ? '花色' : '点数';
  setIconButton(button, 'sort', label, `其他玩家手牌按${label}排序，切换为${mode === 'suit' ? '点数' : '花色'}排序`);
  panel.dataset.sort = mode;
  // Move only the already permitted, read-only card nodes. Never touch state,
  // send a room action, or consult the authority's complete hands.
  for (const group of panel.querySelectorAll('[data-foresight-player]')) {
    const player = state.players.find(player => player.id === group.dataset.foresightPlayer);
    if (!player || player.id === me) continue;
    const cards = group.querySelector('.foresight-cards');
    const nodes = new Map([...cards.children].map(node => [node.dataset.visibleCard, node]));
    for (const card of sortCards(player.hand || [], mode)) {
      const node = nodes.get(card.id);
      if (node) cards.append(node);
    }
  }
}
function updateEventEffects(initial = false) {
  const seq = state?.eventSeq || 0;
  scoreBubbles.sync(state, {initial:initial || seenEventSeq == null, scope:roomEpoch, serverNow:Date.now() + serverClockOffset});
  trumpReveal.sync(state, { initial: initial || seenEventSeq == null, scope: roomEpoch,
    serverNow: Date.now() + serverClockOffset, motion: document.body.dataset.trumpMotion !== 'off' && !motionMedia.matches });
  const leader = state?.trick.length ? state.trick.find(entry => entry.player === winner(state.trick, state.trump, state.options.deckMode))?.card.id : null;
  tableMotion.sync(state, { initial: initial || seenEventSeq == null, serverNow: Date.now() + serverClockOffset, leader, emphasisScale: document.body.dataset.tableLayout === 'strip' ? COMPACT_LEADING_CARD_SCALE : LEADING_CARD_SCALE, reducedMotion: motionMedia.matches });
  seenEventSeq = seq;
  const myTurn = !spectating && (state?.canBid || (state?.players[state.turn]?.id === me && ['play','trump'].includes(state.phase)));
  const cue = myTurn ? `${state.round}:${state.completedTricks}:${state.phase}:${state.turn}` : '';
  if (cue && cue !== lastTurnCue && !state.lifecycle?.paused && networkReady) {
    document.body.classList.remove('turn-arrival'); void document.body.offsetWidth; document.body.classList.add('turn-arrival');
    if (turnSound && !initial) try { const ctx = new AudioContext(),osc=ctx.createOscillator(),gain=ctx.createGain();osc.frequency.value=660;gain.gain.setValueAtTime(.035,ctx.currentTime);gain.gain.exponentialRampToValueAtTime(.001,ctx.currentTime+.18);osc.connect(gain).connect(ctx.destination);osc.start();osc.stop(ctx.currentTime+.18);osc.onended=()=>ctx.close(); } catch {}
  }
  lastTurnCue = cue;
}

function syncPracticeCollection() {
  if (!['trickEnd','roundEnd','finished'].includes(game.phase)) { practiceCollection = null; return; }
  const scope = `${game.round}:${game.completedTricks}`;
  if (practiceCollection?.scope === scope && Number.isFinite(practiceCollection.at)) return;
  const event = game.events?.findLast(event => event.type === 'trickEnd' && event.round === game.round && event.completedTricks === game.completedTricks);
  practiceCollection = Number.isFinite(event?.time) ? {scope, at:event.time + TRICK_REVIEW_MS, remainingMs:null} : null;
  if (practicePaused && practiceCollection) practiceCollection.remainingMs = Math.max(0,practiceCollection.at - Date.now());
}
function broadcast(socialOnly = false) {
  serverClockOffset = 0;
  syncPracticeCollection();
  state = viewFor(game, me);
  state.spectatorCount = 0;
  state.lifecycle = {paused:practicePaused,pauseReason:'房主主动暂停',remainingMs:practiceRemaining,retentionMs:PRACTICE_KEEP_MS,
    collectionAt:practicePaused ? null : practiceCollection?.at ?? null,
    collectionRemainingMs:practiceCollection ? practicePaused ? practiceCollection.remainingMs : Math.max(0,practiceCollection.at-Date.now()) : null};
  updateEventEffects();
  persistRoom();
  render();
  if (socialOnly || practicePaused) return;
  clearTimeout(turnTimer);
  if (game.phase === 'play' && Number.isFinite(game.turnDeadline)) {
    turnTimer = setTimeout(() => {
      try { applyPublicAction(game, me, { type: 'timeout' }); broadcast(); } catch (e) { notify(e.message); }
    }, Math.max(0, game.turnDeadline - Date.now()) + 30);
  } else if (['trickEnd', 'roundEnd'].includes(game.phase) && game.players.every(p => p.online)) {
    const scope = `${game.round}:${game.completedTricks}:${game.phase}`;
    turnTimer = setTimeout(() => {
      if (!practice || practicePaused || scope !== `${game.round}:${game.completedTricks}:${game.phase}`) return;
      try { applyPublicAction(game, me, { type: 'next' }); broadcast(); } catch (e) { notify(e.message); }
    }, Math.max(0, (practiceCollection?.at ?? Date.now() + TRICK_REVIEW_MS) - Date.now()));
  }
  clearTimeout(botTimer);
  const bot = game.players.find(p => p.bot && p.online && botAction(game, p.id));
  if ((practice || networkReady) && bot) botTimer = setTimeout(() => {
    try { const action = botAction(game, bot.id); if (action) { applyPublicAction(game, bot.id, action); broadcast(); } } catch (e) { notify(e.message); }
  }, 750);
}
function send(action, requestId = null) {
  try { enforceRequest(domestic ? 'cn' : 'global', action); } catch(error) { notify(error.message); return false; }
  if (spectating) { notify('观战中，只能查看公开信息。'); return false; }
  if (!practice && !networkReady) { notify('正在恢复连接，请稍候再操作。'); return false; }
  if (practice && practicePaused && !['chat','rename'].includes(action.type)) { notify('牌局已暂停。'); return false; }
  if (practice) {
    try { applyPublicAction(game, me, action); notify(''); broadcast(['chat', 'rename'].includes(action.type)); return true; } catch (e) { notify(e.message); }
  } else if (transport?.send({ type: 'action', action, ...(requestId ? {requestId} : {}) })) return true;
  else notify('连接已中断，正在自动重连，请稍候再操作。');
  return false;
}
function startPractice() {
  if (!saveName()) return;
  stopRoomTransport(); clearRoomSession(sessionStore); identities = {};
  spectating = false;
  practice = true; isHost = true; me = uuidV4(); room = '离线练习';
  game = createGame(domestic ? 'cn' : 'global'); addPlayer(game, me, nickname, false, automaticName, domestic ? selectedNicknameId : undefined);
  addPlayer(game, uuidV4(), '', true, true); addPlayer(game, uuidV4(), '', true, true);
  networkReady = true; busy = false; game.options.short = true; practicePaused = false; practiceRemaining = null; practiceCollection = null; pendingSettlement = null; seenEventSeq = null;
  notify(''); broadcast();
}
function launch(host, restored = null) {
  const watching = !host && restored?.role === 'spectator';
  if (!restored && !watching && !saveName()) return;
  if (busy) return;
  const input = restored?.room || $('#room-input')?.value.trim().toUpperCase();
  const code = parseRoomCode(input);
  if (!host && !code) return notify('请输入有效的 8 位房间码，也可带 C- 或 A- 前缀。');
  if (!host && code.backendId !== backendId()) return notify(FOREIGN_INVITATION);
  const entered = host ? restored?.room : code.room;
  stopRoomTransport(); const epoch = roomEpoch, current = () => roomEpoch === epoch;
  busy = true; networkReady = false; isHost = host; practice = false; spectating = watching;
  game = undefined; state = undefined; me = restored?.me || '';
  room = entered || Array.from(crypto.getRandomValues(new Uint8Array(8)), n => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[n & 31]).join('');
  seenEventSeq = null; selectedCard = null;pendingPlay=null;pendingSettlement=null;
  notify(restored ? '正在恢复原来的牌局…' : host ? '正在创建房间…' : '正在连接房间…'); render();
  let migrationPending=!!restored?.game;
  transport = createRoomTransport({host,room,token,name:domestic ? '' : nickname,nicknameId:domestic ? selectedNicknameId : undefined,automaticName,spectator:watching,snapshot:restored?.game,identities:restored?.identities,
    onFatal(message) { if (current()) leaveRoom(message,false,migrationPending); },
    onStatus(value) {
      if (!current()) return;
      networkReady = value === 'connected'; busy = !networkReady;
      if (!networkReady) { selectedCard = null;pendingPlay=null; seenEventSeq = null; trumpReveal.finish(); scoreBubbles.finish(); }
      notify(networkReady ? '' : '正在恢复连接，同步牌局与计时…'); render();
    },
    onData(msg) {
      if (!current()) return;
      if (msg?.type === 'state' && msg.state?.players) {
        const initial = seenEventSeq == null;
        migrationPending=false;
        me = msg.me || me; isHost = msg.isHost === true; state = msg.state; if (domestic) migrateCNGame(state);
        networkReady = true; busy = false;
        serverClockOffset = Number.isFinite(msg.serverNow) ? msg.serverNow - Date.now() : 0;
        updateEventEffects(initial); persistRoom(); transport.ready(); render();
      }
      if (msg?.type === 'error') {if(pendingPlay?.requestId===msg.requestId)pendingPlay=null;if(pendingSettlement && (!msg.requestId || pendingSettlement.requestId===msg.requestId))pendingSettlement=null;notify(msg.message);render();}
      if (msg?.type === 'removed') leaveRoom('你已被移出房间。',false,false);
      if (msg?.type === 'room-closed') leaveRoom(msg.message || '房间已关闭，旧链接无法恢复。',false,false);
    },
  });
}

const social = new RoomSocial(send, () => {
  layoutSchedule.request();
}, layer => floatingLayers.closeOthers(layer));
const detailsLayer = (id, selector) => ({
  id,
  isOpen:() => !!$(selector)?.open,
  contains:event => containsEvent(event, [$(selector)]),
  close:({restoreFocus}) => {
    const details = $(selector);
    if (details) details.open = false;
    if (id === 'settings') settingsOpen = false;
    if (restoreFocus) details?.querySelector(':scope > summary')?.focus({preventScroll:true});
  },
});
const floatingLayers = new FloatingLayers([
  detailsLayer('settings', '#quick-settings'),
  detailsLayer('settlement', '.settlement-details'),
  {
    id:'menu', isOpen:() => menuOpen,
    contains:event => containsEvent(event, [$('#table-menu-panel'), $('#table-menu')]),
    close:({restoreFocus}) => {
      menuOpen = false; updateFloatingHUD();
      if (restoreFocus) $('#table-menu')?.focus({preventScroll:true});
    },
  },
  {
    id:'scores', isOpen:() => scoresOpen,
    contains:event => containsEvent(event, [$('#table-score-panel'), $('#table-scores'), ...document.querySelectorAll('[data-player-details]')]),
    close:({restoreFocus}) => closeScores(restoreFocus),
  },
  {
    id:'chat', isOpen:() => !domestic && !social.root.hidden && !social.chat.hidden,
    contains:event => containsEvent(event, [social.chat, social.chatButton, social.noticeRegion]),
    close:({restoreFocus}) => { social.closeChat(); if (restoreFocus) social.chatButton?.focus({preventScroll:true}); },
  },
  {
    id:'rename', isOpen:() => !domestic && !social.root.hidden && !social.rename.hidden,
    contains:event => containsEvent(event, [social.rename, social.renameButton]),
    close:({restoreFocus}) => social.closeRename(restoreFocus),
  },
], {
  blocked:() => rulesOpen || !!state?.lifecycle?.continuationVote || !!document.querySelector('dialog[open]'),
  ignoreClick:() => !!selectionPointer?.dragged,
});
floatingLayers.listen(document);
const music = new BackgroundMusic();
const directory = new RoomDirectory({
  onJoin(selectedRoom) {
    if (busy || state) return;
    launch(false, { role: 'guest', room: selectedRoom, me: '' });
  },
  onWatch(selectedRoom) {
    if (busy || state) return;
    launch(false, { role: 'spectator', room: selectedRoom, me: '' });
  },
  onRefresh() { presence?.wake(); },
});
const spectatorActivity = document.createElement('section');
spectatorActivity.className = 'spectator-activity'; spectatorActivity.hidden = true;
spectatorActivity.setAttribute('aria-label', '观战公开操作记录');
spectatorActivity.innerHTML = '<h2>公开操作</h2><ol aria-live="polite" aria-relevant="additions"></ol>';
document.body.append(spectatorActivity);
let presence;
setInterval(updateCountdown, 250);
render();
function startPresence() {
  let visitor;
  try {
    visitor = localStore.getItem('wizard-presence-id');
    if (!visitor) {
      visitor = uuidV4();
      localStore.setItem('wizard-presence-id', visitor);
    }
  } catch { visitor = uuidV4(); }
  presence = createPresence({
    visitor,
    onChange: value => { onlinePresence = value; updateOnlineCount(); directory.update({ rooms: value.rooms || [], status: value.status }); },
  });
}
startPresence();
function restoreRoom(saved) {
  if (!saved) return;
  busy = false;
  if (saved.role === 'practice') {
    stopRoomTransport();
    ({ game, identities, room, me } = saved);
    practiceCollection = saved.collection ?? null;
    practicePaused = saved.paused === true;
    if (domestic) migrateCNGame(game);
    normalizeGame(game);
    practiceRemaining = restorePracticeClock(saved);
    isHost = practice = networkReady = true; spectating = false;
    notify('已恢复原来的练习牌局。'); broadcast();
  } else launch(saved.role === 'host', saved);
}
window.addEventListener('pagehide', () => {
  if (practice && game) {
    const saved={role:'practice',room,me,game,identities,collection:practiceCollection,paused:practicePaused,remainingMs:practicePaused ? practiceRemaining : Math.max(0,game.turnDeadline-Date.now()),leftAt:Date.now()};
    savePractice(localStore,saved,Date.now(),true);saveRoomSession(sessionStore,saved);
  } else persistRoom();
  stopRoomTransport(); networkReady = false; busy = false;
  presence?.stop();
});
window.addEventListener('pageshow', event => {
  if (event.persisted) { startPresence(); restoreRoom(readRoomSession(sessionStore)); }
});
window.addEventListener('resize', () => {
  trumpReveal.finish();
  refreshHandOnLayout = true;
  layoutSchedule.request(); htmlFrame.request();
});
for (const query of ['(max-width:380px)','(max-width:850px)']) matchMedia(query).addEventListener('change', () => layoutSchedule.request());
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) { layoutSchedule.request(); htmlFrame.request(); tableScene?.requestDraw(); }
});
window.addEventListener('offline',()=>{
  if(!practice) {networkReady=false;pendingPlay=null;selectedCard=null;seenEventSeq=null;trumpReveal.finish();transport?.wake();if(state){notify('网络已断开，正在恢复连接…');render();}}
  presence?.wake();
});
window.addEventListener('online', () => { transport?.wake(); presence?.wake(); });
restoreRoom(watchFromURL && initialCode?.backendId === backendId() && savedSession?.role !== 'host'
  ? (savedSession?.role === 'spectator' ? savedSession : { role: 'spectator', room: initialCode.room, me: '' })
  : savedSession);

document.addEventListener('click',event=>{if(event.target.closest?.('[data-safety-notice]'))showSafetyNotice(room || '');});
