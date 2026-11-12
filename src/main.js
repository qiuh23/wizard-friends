import { nicknameFromId, randomNicknameId, migrateCNGame, enforceRequest, FOREIGN_INVITATION } from './site-policy.js';
import { showSafetyNotice } from './safety-notice.js';
import { createGame, addPlayer, viewFor, botAction, normalizeGame, TRICK_REVIEW_MS, SUIT_NAMES, winner } from './game.js';
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
import './variants.css';
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
import { preloadCardFaces } from './card-face.js';
import { captureHand, HandMotion } from './hand-motion.js';
import { CARD_ENTER_MS, LEADING_CARD_SCALE, COMPACT_LEADING_CARD_SCALE, TableMotion } from './table-motion.js';
import { tableLayoutMode } from './table-layout.js';
import { frameScheduler } from './frame-scheduler.js';
import { createLayoutScheduler } from './layout-scheduler.js';
import { updateTableLayout } from './table-layout-dom.js';
import { tableViewKey } from './ui-regions.js';
import { playBlockedReason, isSwipe } from './hand-model.js';
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
import { ScreenDirection } from './screen-direction.js';
import './screen-direction.css';
import './room-experience.css';
import './foresight.css';
import { icon, setIconButton } from './ui-icons.js';
import './immersive-table.css';
// Homepage owns its full visual cascade after the shared table styles.
import './home-menu.css';
import './visual-first.css';
import './table-polish.css';
import './table-play.css';
import { bindBidControls } from './bid-controls.js';
import { FloatingLayers, containsEvent } from './floating-layers.js';
import { renderUI, updateUIDraft } from './ui/root.tsx';

new ScreenDirection();

const sessionStore = backendStorage(globalThis.sessionStorage);
const localStore = backendStorage(globalThis.localStorage);

let onlinePresence = { count: null, status: 'connecting' };
function updateOnlineCount() {
  const badge = document.querySelector('#online-count');
  if (!badge) return;
  badge.dataset.status = onlinePresence.status;
  badge.innerHTML = `${icon('people')}<span>${onlinePresence.count === null
    ? (onlinePresence.status === 'connecting' ? '连接中…' : '连接不可用')
    : `约 ${onlinePresence.count} 人在线`}</span>`;
}

let tableScene, scenePending = false, sceneFailed = false;
let refreshHandOnLayout = false;
const layoutSchedule = createLayoutScheduler(({force}) => {
  if (updateLayoutMetrics(force)) tableScene?.resize();
  social?.positionNotices();
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
  tableMotion.setReducedMotion(motionMedia.matches);
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
const app = $('#app');
let transport, game, state, isHost = false, practice = false, room = '', me = '', identities = {};
let spectating = false;
let botTimer, status = '', busy = false, rulesOpen = false, networkReady = false;
let preferredBotDifficulty = 'smart';
let lobbyPanelRoom = '', lobbyPanel = 'players', lobbyPanelScroll = {players:0,rules:0};
let roomEpoch = 0;
let scoresOpen = false, menuOpen = false;
let scoreSource = null;
let settingsOpen = false, turnTimer, serverClockOffset = 0;
let joinOpen = new URLSearchParams(location.search).has('room');
let joinDraft = null;
let pendingPlay = null, pendingSettlement = null, noticeTimer;
const handMotion = new HandMotion(showHoveredCard, {retainNodes:false});
const tableMotion = new TableMotion();
const trumpReveal = new TrumpReveal();
const scoreBubbles = new ScoreBubbles();
let renderEpoch = 0, hoveredCard = null;
let selectedCard = null, handExpanded = false, handCollapsed = false, handSort = sessionStore.getItem('wizard-hand-sort') === 'rank' ? 'rank' : 'suit', handScroll = 0, gridScroll = 0, selectionContext = '';
let foresightSort = ['suit', 'rank'].includes(sessionStore.getItem('wizard-foresight-sort')) ? sessionStore.getItem('wizard-foresight-sort') : null;
let renderedTableKey = null;
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
  if (message && /^(已恢复|已回到|已加入|房间已准备|邀请链接已复制)/.test(message)) noticeTimer=setTimeout(()=>{
    if(status===message) { status='';const current=$('#notice');if(current)current.textContent=''; }
  },3000);
}
function showHoveredCard(id) {
  if (hoveredCard === id) return;
  hoveredCard = id; updateUIDraft({hoveredCard});
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
function uiModel(returnRooms = []) {
  return {
    state, me, domestic, practice, spectating, isHost, networkReady, room,
    publicCode: room ? publicRoomCode(room) : '', invitation: !room || practice ? '' : invitationURL(room, spectating),
    lobbyURL: gameLobbyURL(), nickname, busy, joinOpen, joinDraft,
    roomInput: roomFromURL || storedRoom,
    returnRooms: returnRooms.map(({room, role}) => ({room, role})), practiceSaved: !!practiceSaved,
    lobbyPanel, preferredBotDifficulty, status, selectedCard, hoveredCard,
    handExpanded, handCollapsed, handSort, foresightSort, pendingPlay: !!pendingPlay,
    pendingSettlement: !!pendingSettlement, scoresOpen, menuOpen, scoreSource, settingsOpen, rulesOpen,
    turnSound, renderEpoch: ++renderEpoch, cardTiming: id => tableMotion.timing(id),
  };
}
function render() {
  const previousForesight = $('.foresight-hands');
  const foresightScroll = previousForesight?.scrollTop || 0;
  const foresightFocus = previousForesight?.contains(document.activeElement) ? document.activeElement.id || 'foresight-hands' : null;
  const previousLobby = $('.lobby-table');
  if (previousLobby) lobbyPanelScroll[previousLobby.dataset.activePanel] = previousLobby.scrollTop;
  const tableKey = tableViewKey(state, [roomEpoch,me,isHost,practice,spectating,networkReady,!!pendingSettlement]);
  if (tableKey && tableKey === renderedTableKey && $('.table')) {
    updateSocialRegions(); refreshSelection(); scoreBubbles.mount(app); htmlFrame.request();
    return;
  }
  renderedTableKey = tableKey; hoveredCard = null;
  const container = $('.table')?.getBoundingClientRect();
  document.body.dataset.tableLayout = tableLayoutMode(container?.width || document.documentElement.clientWidth, container?.height || window.innerHeight);
  const previousHand=captureHand($('.hand'));
  const activeCards = new Set(state?.trick.map(play=>play.card.id) || []);
  for (const id of handPlayOrigins.keys()) if (!activeCards.has(id)) handPlayOrigins.delete(id);
  for (const play of state?.trick || []) {
    const previous = previousHand?.cards.get(play.card.id)?.rect;
    if (previous && state.players[play.player]?.id === me && !handPlayOrigins.has(play.card.id)) {
      handPlayOrigins.set(play.card.id,{x:(previous.left+previous.width/2)/innerWidth,y:(previous.top+previous.height/2)/innerHeight});
    }
  }
  const scorePanel = $('#table-score-panel'), ledger = $('.score-ledger .history-scroll');
  const scoreScroll = { top: scorePanel?.scrollTop || 0, left: ledger?.scrollLeft || 0, row: ledger?.scrollTop || 0 };
  if (!state) {
    if (!domestic && automaticName) { nickname = ''; automaticName = false; persistName(); }
    const invitedRoom = parseRoomCode(roomFromURL)?.backendId === backendId() ? parseRoomCode(roomFromURL).room : roomFromURL;
    const returnSession = readRoomSession(sessionStore,invitedRoom);
    const recoveryHandles=readRoomRecoveries(localStore,invitedRoom);
    const returnRooms=returnSession && returnSession.role !== 'practice' ? [{...returnSession,token},...recoveryHandles.filter(r=>r.room!==returnSession.room || r.token!==token)] : recoveryHandles;
    $('.bid-options')?._disposeBidControls?.();
    renderUI(uiModel(returnRooms));
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
  }
  renderUI(uiModel());
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
  bindBidControls($('.bid-options'));
  document.querySelectorAll('[data-bid]').forEach(b => b.onclick = () => send({ type: 'bid', value: Number(b.dataset.bid) }));
  document.querySelectorAll('button[data-trump]').forEach(b => b.onclick = () => send({ type: 'trump', suit: b.dataset.trump }));

  $('#next')?.addEventListener('click', () => submitSettlement('next'));
  $('#rematch')?.addEventListener('click', () => submitSettlement('rematch'));
}
function bindCommon() {
  const pregame = state && ['lobby', 'rules'].includes(state.phase);
  document.body.dataset.gameTheme = 'wizard';
  document.body.dataset.phase = state?.phase || '';
  document.body.dataset.foresight = String(!!state?.foresightActive && !spectating);
  document.body.dataset.screen = !state ? 'home' : pregame ? 'lobby' : 'game';
  document.body.dataset.connection = !state ? 'home' : practice || networkReady ? 'connected' : 'reconnecting';
  document.body.dataset.spectator = String(spectating);
  if (!state) { updateOnlineCount(); directory.mount($('.home-room-list')); }
  const graphics = $('#graphics');
  graphics.onclick = () => { if (tableScene) { tableScene.setLow(!tableScene.low); updateGraphicsButton(); } };
  $('#trump-motion').onclick = () => {
    trumpMotionPreference = String(document.body.dataset.trumpMotion !== 'on');
    localStore.setItem('wizard-trump-motion', trumpMotionPreference); updateTrumpMotion();
  };
  updateTrumpMotion();
  $('#turn-sound').onclick = () => {
    turnSound = !turnSound; localStore.setItem('wizard-turn-sound', String(turnSound));
    updateUIDraft({turnSound});
  };
  if (state && !pregame) setupGameHUD();
  // Retained controllers render only into deliberately empty extension hosts.
  music.mount($('[data-music-host]'));
  social.update(state, me, $('[data-chat-host]'), { connected: practice || (networkReady && seenEventSeq != null), room });
  if (!domestic && state) {
    if (social.chatButton) $('[data-chat-host]')?.append(social.chatButton);
    $('#chat-form').hidden = spectating;
    if (spectating) { social.renameButton?.remove(); $('#rename-panel').hidden = true; }
    else if (social.renameButton) $('[data-rename-host]')?.append(social.renameButton);
  }
  setupClearUI();
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
  social.positionNotices?.();
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
  decorateHand(); scoreBubbles.mount(app);
  $('#rules').onclick = () => setRulesOpen(true);
  if (rulesOpen) bindRulesModal();
}
function bindRulesModal() {
  const close = $('#close-rules'); if (!close) return;
  close.onclick = () => setRulesOpen(false);
  close.closest('.modal-backdrop').onclick = event => { if (event.target === event.currentTarget) setRulesOpen(false); };
  close.closest('.modal').onkeydown = event => {
    if (event.key !== 'Tab') return;
    const controls = [...event.currentTarget.querySelectorAll('button,a[href]')];
    const edge = event.shiftKey ? controls[0] : controls.at(-1);
    if (document.activeElement === edge) { event.preventDefault(); (event.shiftKey ? controls.at(-1) : controls[0]).focus(); }
  };
}
function setRulesOpen(open) {
  if (open) floatingLayers.closeOthers(null);
  rulesOpen = open; updateUIDraft({rulesOpen});
  if (open) { bindRulesModal(); $('#close-rules').focus(); }
  else {
    const trigger = $('#rules')?.getClientRects().length ? $('#rules') : $('#table-menu') || $('#quick-settings > summary');
    trigger?.focus({preventScroll:true});
  }
}
function updateSocialRegions() {
  updateUIDraft({state});
  social.update(state, me, $('[data-chat-host]'), {connected:practice || (networkReady && seenEventSeq != null),room});
  if (!domestic && social.renameButton) {
    if (spectating) social.renameButton.remove();
    else $('[data-rename-host]')?.append(social.renameButton);
  }
  updateSpectatorActivity(); updateCountdown();
}
// The node list changes only when a game view changes, never on an idle frame.
let htmlCards = [], htmlLinks = null;
const handPlayOrigins = new Map();
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
    node, card:node.querySelector('.card'), shadow:node.querySelector('.card-contact-shadow'), label:node.querySelector(':scope > small'), id:node.dataset.cardId,
  }));
  htmlFrame.request();
}
function drawHTMLCards(sample = tableMotion.snapshot()) {
  if (!state?.trick.length || document.hidden) return;
  const labelOpacity = String(sample.labelOpacity);
  if (htmlLinks && htmlLinks.style.opacity !== labelOpacity) htmlLinks.style.opacity = labelOpacity;
  const webgl = document.body.classList.contains('has-webgl');
  for (const {node,card,shadow,label,id} of htmlCards) {
    if (node.style.getPropertyValue('--played-label-opacity') !== labelOpacity) node.style.setProperty('--played-label-opacity', labelOpacity);
    if (label) {
      if (label.style.opacity !== labelOpacity) label.style.opacity = labelOpacity;
      const visibility = sample.labelOpacity === 0 ? 'hidden' : '';
      if (label.style.visibility !== visibility) label.style.visibility = visibility;
    }
    if (!card) continue;
    const pose = sample.poses.get(id);
    if (!pose) continue;
    const offset = name => parseFloat(node.style.getPropertyValue(name)) || 0;
    const x = offset('--from-x') * (1 - pose.enter) + offset('--winner-dx') * pose.collect;
    const y = offset('--from-y') * (1 - pose.enter) + offset('--winner-dy') * pose.collect - pose.lift;
    const angle = parseFloat(node.style.getPropertyValue('--table-angle')) || 0;
    const transform = `translate(${x}px, ${y}px) perspective(900px) rotateX(32deg) rotateZ(${angle}deg) scale(${pose.scale})`;
    const opacity = String(pose.enter * pose.opacity);
    if(shadow) {
      shadow.style.transform=`translate(${x}px, ${y}px) scale(${pose.scale})`;
      shadow.style.opacity=opacity;
    }
    if(webgl)continue;
    if (card.style.transform !== transform) card.style.transform = transform;
    if (card.style.opacity !== opacity) card.style.opacity = opacity;
  }
}
function updateLayoutMetrics(force = false) {
  const changed=updateTableLayout({state,me,tableMotion,playOrigins:handPlayOrigins,reducedMotion:motionMedia.matches,drawHTMLCards:() => htmlFrame.request(),force});
  // Reuse the existing layout scheduler/observer. Details must fit above the
  // actual result dock after rotation, wrapping names or browser chrome changes.
  const protectedNodes = document.querySelectorAll('.own-status,.hand-section,.concealed-hand,.action-panel:not(.settlement-panel),.settlement-actions');
  const protectedTop = Math.min(window.innerHeight, ...[...protectedNodes].map(node => node.getBoundingClientRect()).filter(rect => rect.width && rect.height).map(rect => rect.top));
  const inset = `${Math.max(12, window.innerHeight - protectedTop + 10)}px`;
  if (document.body.style.getPropertyValue('--ui-overlay-bottom') !== inset) document.body.style.setProperty('--ui-overlay-bottom', inset);
  const dock=$('.settlement-panel');
  if(dock){const top=`${Math.max(0,dock.getBoundingClientRect().top)}px`;if(dock.style.getPropertyValue('--settlement-dock-top')!==top)dock.style.setProperty('--settlement-dock-top',top);}
  return changed;
}
function setupClearUI() {
  const settings = $('#quick-settings');
  if (settings) {
    $('#close-settings').onclick = () => { settings.open = false; settingsOpen = false; settings.querySelector('summary').focus(); };
    settings.ontoggle = () => {
      if (!settings.isConnected) return;
      settingsOpen = settings.open;
      if (settings.open) floatingLayers.closeOthers('settings');
    };
  }
  const settlement = $('.settlement-details');
  if (settlement) settlement.ontoggle = () => { if (settlement.isConnected && settlement.open) floatingLayers.closeOthers('settlement'); };
  updateCountdown();
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
function setupGameHUD() {
  const close = $('.close-scores');
  $('#table-menu').onclick = () => { floatingLayers.closeOthers('menu'); menuOpen = !menuOpen; updateFloatingHUD(); };
  $('#table-scores').onclick = () => { floatingLayers.closeOthers('scores'); scoresOpen = !scoresOpen; scoreSource = null; updateFloatingHUD(); };
  close.onclick = () => closeScores(true);
  document.querySelectorAll('[data-player-details]').forEach(avatar => avatar.onclick = () => {
    floatingLayers.closeOthers('scores');
    scoresOpen = !(scoresOpen && scoreSource === avatar.dataset.playerDetails);
    scoreSource = avatar.dataset.playerDetails; updateFloatingHUD();
    if (scoresOpen) close.focus({preventScroll:true});
  });
  updateFloatingHUD();
}
function updateFloatingHUD() { updateUIDraft({menuOpen, scoresOpen, scoreSource}); }
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
  hoveredCard = null;
  updateUIDraft({selectedCard, hoveredCard, pendingPlay:!!pendingPlay, networkReady});
  handMotion.selected = selectedCard; handMotion.layout();
}
function refreshHand({sort = false} = {}) {
  const hand = $('.hand'); if (!hand) return;
  const previous = captureHand(hand);
  if (hand.classList.contains('hand-grid')) gridScroll = hand.scrollTop; else handScroll = hand.scrollLeft;
  updateUIDraft({handExpanded, handCollapsed, handSort, foresightSort, selectedCard});
  document.body.classList.toggle('hand-expanded', handExpanded && !handCollapsed);
  document.body.classList.toggle('hand-collapsed', handCollapsed);
  decorateHand(); handMotion.attach(hand, previous, selectedCard);
  hand.scrollLeft = handExpanded ? 0 : handScroll; hand.scrollTop = handExpanded ? gridScroll : 0;
  refreshSelection(); layoutSchedule.request();
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
  updateUIDraft({foresightSort, handSort});
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
