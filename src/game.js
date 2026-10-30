import { createRandomStream, validRandomStream, shuffle } from './random.js';
import { resolveName, validateName } from './player-names.js';
import { DEFAULT_OPTIONS, RULE_CHOICES, normalizeOptions, validateOptions } from './rules-options.js';

export const SUITS = ['blue', 'red', 'green', 'yellow'];
export const SUIT_NAMES = { blue: '蓝 · 冰霜', red: '红 · 烈焰', green: '绿 · 森林', yellow: '黄 · 星辰' };
export function deck() {
  return [
    ...SUITS.flatMap(suit => Array.from({ length: 13 }, (_, i) => ({ id: `${suit}-${i + 1}`, suit, rank: i + 1, kind: 'number' }))),
    ...['wizard', 'jester'].flatMap(kind => Array.from({ length: 4 }, (_, i) => ({ id: `${kind}-${i}`, kind }))),
  ];
}
export function monoDeck(suit) {
  return [
    ...Array.from({ length: 13 }, (_, i) => ({ id: `${suit}-${i + 1}`, suit, rank: i + 1, kind: 'number' })),
    ...['wizard', 'jester'].map(kind => ({ id: `${kind}-${suit}`, kind })),
  ];
}
export function shuffled(cards, random) {
  // Function injection is a legacy deterministic test/replay interface only.
  // Every production deal passes the game's persisted ChaCha20 state.
  if (typeof random !== 'function') return shuffle(cards, random);
  const copy = [...cards];
  for (let i = copy.length - 1; i > 0; i--) {
    const sample = random();
    if (!Number.isFinite(sample) || sample < 0 || sample >= 1) throw Error('测试随机源必须返回0至1之间的数。');
    const j = Math.floor(sample * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}
export function leadSuit(trick, deckMode = 'standard') {
  if (deckMode === 'mono') return null;
  const first = trick.find(x => x.card.kind !== 'jester');
  return first?.card.kind === 'number' ? first.card.suit : null;
}
export function legalCards(hand, trick, deckMode = 'standard') {
  const suit = leadSuit(trick, deckMode);
  if (!suit || !hand.some(c => c.kind === 'number' && c.suit === suit)) return hand;
  return hand.filter(c => c.kind !== 'number' || c.suit === suit);
}
export function winner(trick, trump, deckMode = 'standard') {
  const wizard = trick.find(x => x.card.kind === 'wizard');
  if (wizard) return wizard.player;
  const numbers = trick.filter(x => x.card.kind === 'number');
  if (!numbers.length) return trick[0].player;
  const suit = numbers.some(x => x.card.suit === trump) ? trump : numbers[0].card.suit;
  const candidates = deckMode === 'mono' ? numbers : numbers.filter(x => x.card.suit === suit);
  return candidates.reduce((a, b) => a.card.rank >= b.card.rank ? a : b).player;
}
export const points = (bid, won) => bid === won ? 20 + won * 10 : -10 * Math.abs(bid - won);
export function createGame() {
  return {
    phase: 'lobby', players: [], round: 0, cardsPerRound: 0, dealer: 0, turn: 0, rulesVersion: 3,
    trump: null, reveal: null, trick: [], history: [], log: [], options: { ...DEFAULT_OPTIONS },
    randomState: createRandomStream(), events: [], eventSeq: 0, playedCards: [],
  };
}
export function normalizeGame(g) {
  g.options = normalizeOptions(g.options);
  // Old saves already contain the dealt hands. Seed only future shuffles, never re-deal.
  g.randomState ??= createRandomStream();
  if (!validRandomStream(g.randomState)) throw Error('随机流存档损坏，已停止操作以保护原牌局。');
  // Before per-round voting, foresight applied only to round one even when its option stayed true.
  if ((g.rulesVersion ?? 1) < 2) {
    if (g.round > 1) g.options.foresight = false;
  }
  g.cardsPerRound ??= g.round + (g.options.deckMode === 'mono' && g.round ? 3 : 0);
  // Retire old rule ballots without dealing again or discarding settled scores.
  if (g.phase === 'rules') {
    if (!g.round) g.options = normalizeOptions({ ...g.options, ...g.vote?.resolved });
    g.phase = g.round ? 'roundEnd' : 'lobby';
  }
  delete g.vote;
  g.rulesVersion = 3;
  g.players.forEach(p => { p.matchWins = Number.isSafeInteger(p.matchWins) && p.matchWins >= 0 ? p.matchWins : 0; });
  return g;
}
export function addPlayer(g, id, name, bot = false, automatic = false) {
  if (g.phase !== 'lobby' || g.players.length >= 6) throw new Error('房间已开始或已满员。');
  if (g.players.some(p => p.id === id)) throw new Error('玩家已在房间。');
  const automaticName = bot && (automatic || typeof name === 'string' && !name.trim());
  const resolved = resolveName(name, g.players.map(p => p.name), { bot, automatic: automaticName });
  g.players.push({ id, name: resolved, automaticName, bot, ...(bot ? { botDifficulty: 'smart' } : {}), score: 0, matchWins: 0, bid: null, won: 0, hand: [], online: true });
}
function deal(g, random) {
  g.round++;
  // Previous-round public cards must not be mistaken for newly revealed hands after re-deal.
  g.events = [];
  g.playedCards = [];
  g.cardsPerRound = g.round + (g.options.deckMode === 'mono' ? 3 : 0);
  g.players.forEach(p => { p.hand = []; p.bid = null; p.won = 0; });
  if (g.options.deckMode === 'mono') {
    g.players.forEach(p => { p.hand = shuffled(monoDeck(p.monoSuit), random).slice(0, g.cardsPerRound); });
    g.reveal = null;
  } else {
    const cards = shuffled(deck(), random);
    for (let i = 0; i < g.cardsPerRound; i++) {
      for (let j = 1; j <= g.players.length; j++) g.players[(g.dealer + j) % g.players.length].hand.push(cards.pop());
    }
    g.reveal = cards.pop() ?? null;
  }
  g.trump = g.reveal?.kind === 'number' ? g.reveal.suit : null;
  g.trick = [];
  g.completedTricks = 0;
  g.lastWinner = null;
  g.phase = g.reveal?.kind === 'wizard' ? 'trump' : 'bid';
  g.turn = g.phase === 'trump' ? g.dealer : (g.dealer + 1) % g.players.length;
  g.log = [`第 ${g.round} 轮开始，每人 ${g.cardsPerRound} 张牌。`];
}
export function allowedBids(g) {
  const size = g.cardsPerRound ?? g.round;
  return Array.from({ length: size + 1 }, (_, i) => i).filter(n =>
    !(g.options.strict && (g.options.predictionMode ?? 'public') === 'public' &&
      g.players.filter(p => p.bid === null).length === 1 &&
      g.players.reduce((s, p) => s + (p.bid ?? 0), 0) + n === size));
}
function canBid(g, id) {
  const p = g.players.find(x => x.id === id);
  return g.phase === 'bid' && !!p?.online && p.bid === null &&
    ((g.options.predictionMode ?? 'public') !== 'public' || g.players[g.turn]?.id === id);
}
function foresightActive(g) {
  return !!g.options.foresight && ['trump', 'bid'].includes(g.phase);
}
export const TURN_MS = 30000;
export const TRICK_REVIEW_MS = 3000;
export function act(g, actor, action, random, now = Date.now()) {
  const phase = g.phase, turn = g.turn;
  if (g.paused === true && !['chat', 'rename'].includes(action?.type)) throw Error('房主已暂停牌局。');
  const before = { phase, turn, round: g.round, completedTricks: g.completedTricks ?? 0, history: g.history.length };
  const source = () => {
    if (random !== undefined) return random;
    g.randomState ??= createRandomStream();
    return g.randomState;
  };
  if (action?.type === 'play' && phase === 'play' && Number.isFinite(g.turnDeadline) && now >= g.turnDeadline) throw new Error('出牌时间已到，正在自动出牌。');
  applyAction(g, actor, action, source, false, now);
  if (!['chat', 'rename'].includes(action.type)) {
    if (g.phase === 'play' && g.paused !== true) {
      if (phase !== 'play' || turn !== g.turn || !Number.isFinite(g.turnDeadline)) g.turnDeadline = now + TURN_MS;
    } else if (g.phase !== 'play' && g.turnDeadline != null) g.turnDeadline = null;
  }
  recordEvents(g, before, action, now);
}
function applyAction(g, actor, action, randomSource, timedOut = false, now = Date.now()) {
  if (!action || typeof action !== 'object') throw new Error('无效操作。');
  if (['beginVote', 'vote', 'cancelVote'].includes(action.type)) throw new Error('规则已改为房主在开局前选择，请刷新页面。');
  if (action.type === 'chat' || action.type === 'rename') {
    const member = g.players.find(p => p.id === actor && p.online && !p.bot);
    if (!member) throw new Error('只有已入座的在线玩家可以操作。');
    if (action.type === 'rename') {
      validateName(action.name);
      member.name = resolveName(action.name, g.players.filter(p => p.id !== actor).map(p => p.name));
      member.automaticName = false;
    } else {
      if (typeof action.text !== 'string' || !action.text.trim() || action.text.length > 300) throw new Error('消息需要 1–300 个字符。');
      const recent = (g.chat || []).filter(m => m.player === actor && now - m.time < 5000);
      if (recent.length >= 5) throw new Error('消息发送太快，请稍等几秒。');
      g.chatSeq = (g.chatSeq || 0) + 1;
      g.chat = [...(g.chat || []), { seq: g.chatSeq, player: actor, name: member.name, text: action.text.trim(), time: now }].slice(-100);
    }
    return;
  }
  const host = g.players[0];
  if (['configure', 'start', 'rematch', 'next', 'timeout'].includes(action.type) &&
      (actor !== host?.id || !host.online)) throw new Error('等待房主操作。');
  if (action.type === 'timeout') {
    if (g.phase !== 'play' || !Number.isFinite(g.turnDeadline) || now < g.turnDeadline) throw new Error('尚未到出牌超时时间。');
    const player = g.players[g.turn];
    const cards = legalCards(player.hand, g.trick, g.options.deckMode).slice().sort((a, b) =>
      (a.kind === 'wizard' ? 100 : a.kind === 'jester' ? 0 : a.rank) -
      (b.kind === 'wizard' ? 100 : b.kind === 'jester' ? 0 : b.rank));
    // Only an authorized timeout may play for a disconnected seat.
    applyAction(g, player.id, { type: 'play', card: cards[0].id }, randomSource, true, now);
    g.log.push(`${player.name} 超时，已自动出牌。`);
    return;
  }
  if (action.type === 'configure') {
    if (g.phase !== 'lobby') throw new Error('整局规则只能在游戏开始前选择。');
    g.options = validateOptions(action.options, g.players.length);
    return;
  }
  if (action.type === 'start') {
    if (g.phase !== 'lobby' || g.players.length < 3 || g.players.length > 6 ||
        g.players.some(p => !p.online) || !g.players.some(p => !p.bot)) throw new Error('需要 3–6 位在线玩家，由房主开始游戏。');
    const options = validateOptions(Object.hasOwn(action, 'options') ? action.options : g.options, g.players.length);
    g.options = options;
    g.maxRounds = options.short ? 5 : options.deckMode === 'mono' ? 12 : Math.floor(60 / g.players.length);
    if (options.deckMode === 'mono') {
      const suits = shuffled(SUITS, randomSource());
      g.players.forEach((p, index) => { p.monoSuit = suits[index]; });
    }
    deal(g, randomSource());
    return;
  }
  if (action.type === 'rematch') {
    if (g.phase !== 'finished') throw new Error('本局结束后才能再来一局。');
    const players = g.players.map(({ monoSuit, ...p }) => ({ ...p, score: 0, bid: null, won: 0, hand: [] }));
    const { chat, chatSeq, eventSeq = 0, options } = g;
    for (const key of Object.keys(g)) delete g[key];
    Object.assign(g, createGame(), { players, eventSeq, options }, chat ? { chat, chatSeq } : {});
    return;
  }
  if (action.type === 'next') {
    if (!['trickEnd', 'roundEnd'].includes(g.phase)) throw new Error('等待房主继续。');
    if (g.phase === 'roundEnd') {
      if (g.players.some(p => !p.online)) throw new Error('等待所有玩家重连后开始下一轮。');
      g.dealer = (g.dealer + 1) % g.players.length;
      deal(g, randomSource());
    }
    else { g.trick = []; g.turn = g.lastWinner; g.phase = 'play'; }
    return;
  }
  if (action.type === 'bid' && g.phase === 'bid') {
    if (!canBid(g, actor)) throw new Error('还没有轮到你预估，或你已提交。');
    if (!allowedBids(g).includes(action.value)) throw new Error('这个预言数不符合当前规则。');
    const p = g.players.find(x => x.id === actor);
    p.bid = action.value;
    const mode = g.options.predictionMode ?? 'public';
    g.log.push(mode === 'public' ? `${p.name} 预言 ${p.bid} 墩。` : `${p.name} 已提交预估。`);
    if (mode === 'public') g.turn = (g.turn + 1) % g.players.length;
    if (g.players.every(x => x.bid !== null)) {
      g.phase = 'play';
      g.turn = (g.dealer + 1) % g.players.length;
      if (mode === 'hidden') g.log.push(...g.players.map(x => `${x.name} 预言 ${x.bid} 墩。`));
    }
    return;
  }
  const p = g.players[g.turn];
  if (!p || p.id !== actor || (!p.online && !timedOut)) throw new Error('还没有轮到你。');
  if (action.type === 'trump' && g.phase === 'trump') {
    if (!SUITS.includes(action.suit)) throw new Error('请选择一种王牌花色。');
    g.trump = action.suit;
    g.phase = 'bid';
    g.turn = (g.dealer + 1) % g.players.length;
    return;
  }
  if (action.type === 'play' && g.phase === 'play') {
    const card = legalCards(p.hand, g.trick, g.options.deckMode).find(c => c.id === action.card);
    if (!card) throw new Error('这张牌不能出：有首攻花色时必须跟色，巫师和小丑除外。');
    p.hand.splice(p.hand.findIndex(c => c.id === card.id), 1);
    g.trick.push({ player: g.turn, card });
    g.playedCards = [...(g.playedCards ?? []), { player: g.turn, card: safeCard(card) }].slice(-60);
    g.turn = (g.turn + 1) % g.players.length;
    if (g.trick.length === g.players.length) {
      g.lastWinner = winner(g.trick, g.trump, g.options.deckMode);
      g.players[g.lastWinner].won++;
      g.completedTricks++;
      g.phase = 'trickEnd';
      g.log.push(`${g.players[g.lastWinner].name} 赢得第 ${g.completedTricks} 墩。`);
      if (g.completedTricks === (g.cardsPerRound ?? g.round)) {
        const result = g.players.map(x => {
          const delta = points(x.bid, x.won); x.score += delta;
          return { id: x.id, bid: x.bid, won: x.won, delta, total: x.score };
        });
        g.history.push({ round: g.round, cardsPerRound: g.cardsPerRound ?? g.round, options: { ...g.options }, result });
        g.phase = g.round === g.maxRounds ? 'finished' : 'roundEnd';
        if (g.phase === 'finished') {
          const highScore = Math.max(...g.players.map(x => x.score));
          g.players.filter(x => x.score === highScore).forEach(x => { x.matchWins = (x.matchWins ?? 0) + 1; });
        }
        if (g.options.predictionMode === 'secret') g.log.push(...g.players.map(x => `${x.name} 预言 ${x.bid} 墩。`));
      }
    }
    return;
  }
  throw new Error('当前阶段不能执行这个操作。');
}
function safeCard(card) {
  if (!card || !['number', 'wizard', 'jester'].includes(card.kind)) return null;
  return card.kind === 'number'
    ? { id: card.id, kind: card.kind, suit: card.suit, rank: card.rank }
    : { id: card.id, kind: card.kind };
}
function safeResult(result) {
  return result.map(({ id, bid, won, delta, total }) => ({ id, bid, won, delta, total }));
}
function appendEvent(g, type, payload, now) {
  const seq = (g.eventSeq ?? 0) + 1;
  g.eventSeq = seq;
  g.events = [...(g.events ?? []), { seq, type, time: now, round: g.round, ...payload }].slice(-100);
}
function recordEvents(g, before, action, now) {
  if (['play', 'timeout'].includes(action.type) && g.trick.length) {
    const { player, card } = g.trick.at(-1);
    appendEvent(g, 'play', { player, card: safeCard(card), trick: before.completedTricks + 1 }, now);
  }
  if ((g.completedTricks ?? 0) > before.completedTricks) {
    appendEvent(g, 'trickEnd', { winner: g.lastWinner, completedTricks: g.completedTricks }, now);
  }
  if (g.history.length > before.history) appendEvent(g, 'roundEnd', { result: safeResult(g.history.at(-1).result) }, now);
  if (g.round !== before.round) appendEvent(g, 'round', { cardsPerRound: g.cardsPerRound }, now);
  if (g.phase !== before.phase || g.turn !== before.turn) appendEvent(g, 'turn', { phase: g.phase, turn: g.turn }, now);
}
/** Events have their own schema: accidentally attaching private state cannot expand a public view. */
export function publicGameEvents(g) {
  return (g.events ?? []).filter(event => Number.isInteger(event.seq) && Number.isFinite(event.time)).flatMap(event => {
    const base = { seq: event.seq, type: event.type, time: event.time, round: event.round };
    if (event.type === 'play' && safeCard(event.card)) return [{ ...base, player: event.player, card: safeCard(event.card), trick: event.trick }];
    if (event.type === 'trickEnd') return [{ ...base, winner: event.winner, completedTricks: event.completedTricks }];
    if (event.type === 'roundEnd') {
      // A corrupted/imported save must not smuggle an unfinished round's predictions into an event.
      if (event.round > g.round || (event.round === g.round && !['roundEnd', 'finished', 'rules'].includes(g.phase))) return [];
      return [{ ...base, result: safeResult(event.result ?? []) }];
    }
    if (event.type === 'turn') return [{ ...base, phase: event.phase, turn: event.turn }];
    if (event.type === 'round') return [{ ...base, cardsPerRound: event.cardsPerRound }];
    return [];
  }).slice(-100);
}
function publicOptions(source) {
  return normalizeOptions(Object.fromEntries(Object.entries(RULE_CHOICES)
    .filter(([key, values]) => values.includes(source?.[key])).map(([key]) => [key, source[key]])));
}
export function viewFor(g, id) {
  const { players } = g;
  // Never spread authority state here: random keys, deck state, identity maps and lifecycle
  // implementation fields are private even if added by a future engine/controller version.
  const fields = ['phase', 'round', 'cardsPerRound', 'dealer', 'turn', 'rulesVersion', 'trump',
    'maxRounds', 'completedTricks', 'lastWinner', 'turnDeadline', 'spectatorCount'];
  const publicGame = Object.fromEntries(fields.filter(key => Object.hasOwn(g, key)).map(key => [key, g[key]]));
  const foresight = foresightActive(g);
  const seated = players.some(p => p.id === id);
  const mode = g.options.predictionMode ?? 'public';
  const hiddenBids = mode === 'secret' ? ['trump', 'bid', 'play', 'trickEnd'].includes(g.phase) : mode === 'hidden' && ['trump', 'bid'].includes(g.phase);
  const canPredict = canBid(g, id);
  return {
    ...publicGame,
    options: publicOptions(g.options), reveal: safeCard(g.reveal),
    trick: (g.trick ?? []).map(({ player, card }) => ({ player, card: safeCard(card) })),
    history: (g.history ?? []).filter(entry => !hiddenBids || entry.round < g.round).map(entry => ({
      round: entry.round, cardsPerRound: entry.cardsPerRound ?? entry.round,
      ...(entry.options ? { options: publicOptions(entry.options) } : {}), result: safeResult(entry.result ?? []),
    })),
    log: (g.log ?? []).filter(line => typeof line === 'string' && (!hiddenBids || !/预[言估]\s*\d+\s*墩/.test(line))),
    ...(g.chat ? { chat: g.chat.map(({ seq, player, name, text, time }) => ({ seq, player, name, text, time })) } : {}),
    ...(g.chatSeq != null ? { chatSeq: g.chatSeq } : {}),
    ...(g.publicEvents ? { publicEvents: g.publicEvents.map(({ seq, time, text }) => ({ seq, time, text })) } : {}),
    ...(g.publicEventSeq != null ? { publicEventSeq: g.publicEventSeq } : {}),
    events: publicGameEvents(g), eventSeq: g.eventSeq ?? 0,
    playedCards: (g.playedCards ?? []).map(({ player, card }) => ({ player, card: safeCard(card) })),
    foresightActive: foresight,
    cardsPerRound: g.cardsPerRound ?? g.round,
    players: players.map(p => {
      const publicPlayer = Object.fromEntries(['id', 'name', 'automaticName', 'bot', 'botDifficulty', 'score', 'matchWins', 'won', 'online', 'monoSuit']
        .filter(key => Object.hasOwn(p, key)).map(key => [key, p[key]]));
      const showHand = seated && (foresight ? p.id !== id : p.id === id);
      return { ...publicPlayer, bid: hiddenBids && p.id !== id ? null : p.bid,
        bidSubmitted: p.bid !== null, count: Array.isArray(p.hand) ? p.hand.length : p.count ?? 0,
        ...(showHand ? { hand: (p.hand ?? []).map(safeCard) } : {}) };
    }),
    legal: g.phase === 'play' && players[g.turn]?.id === id ? legalCards(players[g.turn].hand, g.trick, g.options.deckMode).map(c => c.id) : [],
    canBid: canPredict,
    bids: canPredict ? allowedBids(g) : [],
  };
}
export function spectatorView(g) {
  const options = publicOptions(g.options);
  const players = g.players.map(player => ({ ...player, hand: Array.isArray(player.hand) ? player.hand : [] }));
  // A Symbol cannot match a player seat, even if a caller supplies an existing spectator ID.
  const visible = viewFor({ ...g, options, players }, Symbol('spectator'));
  const hiddenBids = options.predictionMode === 'secret' ? ['trump', 'bid', 'play', 'trickEnd'].includes(g.phase) :
    options.predictionMode === 'hidden' && ['trump', 'bid'].includes(g.phase);
  const number = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
  const card = value => {
    if (!value || !['number', 'wizard', 'jester'].includes(value.kind)) return null;
    if (value.kind === 'number') return SUITS.includes(value.suit) && Number.isInteger(value.rank) && value.rank >= 1 && value.rank <= 13 ?
      { id: `${value.suit}-${value.rank}`, kind: 'number', suit: value.suit, rank: value.rank } : null;
    const suffix = typeof value.id === 'string' && /^(wizard|jester)-(?:[0-3]|blue|red|green|yellow)$/.test(value.id) ? value.id.split('-')[1] : '0';
    return { id: `${value.kind}-${suffix}`, kind: value.kind };
  };
  // Select public fields explicitly: the host's complete game can contain identity tokens or future private data.
  return {
    phase: visible.phase, round: number(visible.round), cardsPerRound: number(visible.cardsPerRound),
    dealer: number(visible.dealer), turn: number(visible.turn),
    trump: SUITS.includes(visible.trump) ? visible.trump : null, reveal: card(visible.reveal),
    options, maxRounds: number(visible.maxRounds), completedTricks: number(visible.completedTricks),
    lastWinner: Number.isInteger(visible.lastWinner) ? visible.lastWinner : null,
    turnDeadline: Number.isFinite(visible.turnDeadline) ? visible.turnDeadline : null,
    players: visible.players.map((player, index) => ({
      id: typeof player.id === 'string' ? player.id : '', name: typeof player.name === 'string' ? player.name : '', automaticName: player.automaticName === true,
      bot: player.bot === true, ...(player.bot ? { botDifficulty: player.botDifficulty === 'simple' ? 'simple' : 'smart' } : {}), online: player.online === true, score: number(player.score), won: number(player.won), matchWins: number(player.matchWins),
      bid: hiddenBids || !Number.isInteger(player.bid) ? null : player.bid,
      bidSubmitted: g.players[index].bidSubmitted === true || g.players[index].bid != null,
      count: Array.isArray(g.players[index].hand) ? g.players[index].hand.length : Math.max(0, number(g.players[index].count)),
      ...(SUITS.includes(player.monoSuit) ? { monoSuit: player.monoSuit } : {}),
    })),
    trick: (visible.trick || []).flatMap(play => {
      const publicCard = card(play.card);
      return publicCard && Number.isInteger(play.player) && play.player >= 0 && play.player < players.length ? [{ player: play.player, card: publicCard }] : [];
    }),
    history: (visible.history || []).filter(entry => !hiddenBids || entry.round < visible.round).map(entry => ({
      round: number(entry.round), cardsPerRound: number(entry.cardsPerRound, number(entry.round)),
      ...(entry.options ? { options: publicOptions(entry.options) } : {}),
      result: (entry.result || []).filter(result => players.some(player => player.id === result.id)).map(result => ({
        id: result.id, bid: number(result.bid), won: number(result.won), delta: number(result.delta), total: number(result.total),
      })),
    })),
    // Old or accidentally unsanitized snapshots must not reveal a locked prediction through the journal.
    log: (visible.log || []).filter(line => typeof line === 'string' && (!hiddenBids || !/预[言估]\s*\d+\s*墩/.test(line))),
    chat: (visible.chat || []).filter(message => typeof message.text === 'string').map(message => ({
      seq: number(message.seq), player: typeof message.player === 'string' ? message.player : '',
      name: typeof message.name === 'string' ? message.name : '', text: message.text, time: number(message.time),
    })),
    chatSeq: number(visible.chatSeq),
    publicEvents: (visible.publicEvents || []).filter(event => Number.isFinite(event.seq) && Number.isFinite(event.time) &&
      typeof event.text === 'string' && event.text.length <= 300).slice(-100).map(({ seq, time, text }) => ({ seq, time, text })),
    publicEventSeq: number(visible.publicEventSeq),
    events: publicGameEvents(visible), eventSeq: number(visible.eventSeq),
    playedCards: (visible.playedCards ?? []).map(({ player, card: played }) => ({ player, card: card(played) })),
    spectatorCount: Math.max(0, Math.min(50, Math.floor(number(visible.spectatorCount)))),
    spectator: true, foresightActive: false, canBid: false, legal: [], bids: [],
  };
}
// Bounded deterministic evaluation: at most 20 candidates × 60 public-pool cards.
// No simulations consume the authority's dealing stream, and no hidden state is read.
function unseenCards(v, hand) {
  const known = new Set([...hand, ...v.trick.map(play => play.card), v.reveal,
    ...v.playedCards.map(play => play.card),
    ...v.events.filter(event => event.type === 'play' && event.round === v.round).map(event => event.card)]
    .filter(Boolean).map(card => card.id));
  const pool = v.options.deckMode === 'mono' ? v.players.flatMap(player => monoDeck(player.monoSuit)) : deck();
  return pool.filter(card => !known.has(card.id));
}
function probabilityWins(v, index, card, pool, trick = v.trick, remaining = v.players.length - trick.length - 1) {
  const candidate = [...trick, { player: index, card }];
  if (winner(candidate, v.trump, v.options.deckMode) !== index) return 0;
  if (remaining === 0 || card.kind === 'wizard') return 1;
  const threats = pool.filter(other => winner([...candidate, { player: -1, card: other }], v.trump, v.options.deckMode) === -1).length;
  const singleThreat = threats / Math.max(1, pool.length);
  // Other seats can choose among their remaining cards. This uses the publicly known
  // round size, never private hand arrays or secret opponent predictions.
  const opportunities = Math.min(4, Math.max(1, v.cardsPerRound - (v.completedTricks ?? 0)));
  return (1 - singleThreat) ** (remaining * (1 + (opportunities - 1) * 0.35));
}
function distribution(probabilities) {
  let result = [1];
  for (const probability of probabilities) {
    const next = Array(result.length + 1).fill(0);
    for (let i = 0; i < result.length; i++) { next[i] += result[i] * (1 - probability); next[i + 1] += result[i] * probability; }
    result = next;
  }
  return result;
}
const expectedPoints = (bid, won, probabilities) => distribution(probabilities)
  .reduce((sum, probability, extra) => sum + probability * points(bid, won + extra), 0);

export function botAction(g, actorId = g.players[g.turn]?.id, difficulty) {
  const v = viewFor(g, actorId);
  const index = v.players.findIndex(player => player.id === actorId), p = v.players[index];
  if (!p?.bot || !p.online) return null;
  if ((difficulty ?? p.botDifficulty ?? 'smart') === 'simple') return simpleBotAction(g, actorId);
  const hand = p.hand ?? [];
  if (v.phase === 'trump' && v.turn === index) {
    if (!hand.length) return { type: 'trump', suit: SUITS[0] };
    const value = suit => hand.reduce((sum, card) => sum + (card.suit === suit ? 1 + card.rank / 13 : 0), 0);
    return { type: 'trump', suit: SUITS.reduce((best, suit) => value(suit) > value(best) ? suit : best) };
  }
  if (v.canBid) {
    let probabilities;
    if (v.foresightActive) {
      const others = v.players.filter(player => player.id !== actorId).flatMap(player => player.hand ?? []);
      const visiblePower = others.reduce((sum, card) => sum + (card.kind === 'wizard' ? 1 : card.kind === 'jester' ? 0 :
        v.options.deckMode === 'mono' ? card.rank / 26 : card.suit === v.trump ? (card.rank + 3) / 16 : Math.max(0, card.rank - 9) / 8), 0);
      const expected = Math.max(0, Math.min(v.cardsPerRound, v.cardsPerRound - visiblePower));
      probabilities = Array(v.cardsPerRound).fill(expected / Math.max(1, v.cardsPerRound));
    } else {
      const pool = unseenCards(v, hand);
      probabilities = hand.slice(0, 20).map(card => probabilityWins(v, index, card, pool, [], v.players.length - 1));
    }
    // Optimize the published exact-hit/absolute-error score, rather than rounding mean wins.
    return { type: 'bid', value: v.bids.reduce((best, value) =>
      expectedPoints(value, 0, probabilities) > expectedPoints(best, 0, probabilities) ? value : best) };
  }
  if (v.phase === 'play' && v.turn === index) {
    const cards = hand.filter(card => v.legal.includes(card.id)).slice(0, 20);
    if (!cards.length) return null;
    const pool = unseenCards(v, hand);
    const strength = card => card.kind === 'wizard' ? 100 : card.kind === 'jester' ? -1 : card.rank + (card.suit === v.trump ? 20 : 0);
    const remaining = hand.map(card => probabilityWins(v, index, card, pool, [], v.players.length - 1));
    let best = cards[0], bestValue = -Infinity;
    for (const card of cards) {
      const win = probabilityWins(v, index, card, pool);
      const future = remaining.filter((_, i) => hand[i].id !== card.id);
      const value = win * expectedPoints(p.bid, p.won + 1, future) + (1 - win) * expectedPoints(p.bid, p.won, future);
      // Stable tie break conserves winners when still short; sheds them after reaching the target.
      const tie = p.bid > p.won ? -strength(card) : strength(card);
      const bestTie = p.bid > p.won ? -strength(best) : strength(best);
      if (value > bestValue + 1e-9 || (Math.abs(value - bestValue) < 1e-9 && tie > bestTie)) {
        best = card; bestValue = value;
      }
    }
    return { type: 'play', card: best.id };
  }
  return null;
}
function simpleBotAction(g, actorId) {
  const v = viewFor(g, actorId);
  const index = v.players.findIndex(x => x.id === actorId);
  const p = v.players[index];
  if (!p?.bot || !p.online) return null;
  const hand = p.hand ?? [];
  if (v.phase === 'trump' && v.turn === index) {
    return { type: 'trump', suit: SUITS.reduce((a, b) => hand.filter(c => c.suit === a).length >= hand.filter(c => c.suit === b).length ? a : b) };
  }
  if (v.canBid) {
    const estimate = v.foresightActive ? v.cardsPerRound / v.players.length : hand.reduce((n, c) =>
      n + (c.kind === 'wizard' ? 1 : c.kind === 'jester' ? 0 : v.options.deckMode === 'mono' ? c.rank / 26 : c.suit === v.trump ? (c.rank + 3) / 16 : Math.max(0, c.rank - 9) / 8), 0);
    const target = Math.min(v.cardsPerRound, Math.round(estimate));
    return { type: 'bid', value: v.bids.reduce((a, b) => Math.abs(a - target) <= Math.abs(b - target) ? a : b) };
  }
  if (v.phase === 'play' && v.turn === index) {
    const strength = c => c.kind === 'wizard' ? 100 : c.kind === 'jester' ? -1 : c.rank + (c.suit === v.trump ? 20 : 0);
    const cards = hand.filter(c => v.legal.includes(c.id)).sort((a, b) => strength(a) - strength(b));
    if (!cards.length) return null;
    const needs = p.won < p.bid;
    const wins = cards.filter(card => winner([...v.trick, { player: index, card }], v.trump, v.options.deckMode) === index);
    const loses = cards.filter(card => !wins.includes(card));
    return { type: 'play', card: (needs ? (wins[0] ?? cards[0]) : (loses.at(-1) ?? cards[0])).id };
  }
  return null;
}
