import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, addPlayer, act, viewFor, spectatorView, normalizeGame } from '../src/game.js';
import { BOT_NAMES } from '../src/player-names.js';
import { RoomAuthority } from '../worker/room-authority.js';
import { trumpStyle, TRUMP_COLORS } from '../src/trump-style.js';
import { DEFAULT_OPTIONS } from '../src/rules-options.js';
function room() {
  const game = createGame();
  addPlayer(game, 'host', '房主');
  addPlayer(game, 'guest', '朋友');
  addPlayer(game, 'bot', '机器人', true);
  return game;
}
function start(game) {
  act(game, 'host', { type: 'configure', options: { ...DEFAULT_OPTIONS, short: true } });
  act(game, 'host', { type: 'start' });
}
test('rename is authenticated, self-only, validated, and independent of turn', () => {
  const game = room();
  act(game, 'guest', { type: 'rename', name: '  新名字  ', player: 'host' });
  assert.equal(game.players[1].name, '新名字');
  assert.equal(game.players[0].name, '房主');
  start(game);
  act(game, 'guest', { type: 'rename', name: '开局后改名' });
  assert.equal(viewFor(game, 'host').players[1].name, '开局后改名');
  for (const name of ['', ' ', 'a'.repeat(17), '换\n行', null]) {
    assert.throws(() => act(game, 'guest', { type: 'rename', name }));
  }
  for (const actor of ['outsider', 'bot']) assert.throws(() => act(game, actor, { type: 'rename', name: '伪装' }));
  game.players[1].online = false;
  assert.throws(() => act(game, 'guest', { type: 'rename', name: '离线' }));
});
test('chat uses authoritative identity, preserves send-time name and does not change game play', () => {
  const game = room();
  start(game);
  const before = structuredClone(game);
  act(game, 'guest', { type: 'chat', text: '<b>你好</b>', name: '房主', player: 'host' });
  assert.equal(game.chat[0].player, 'guest');
  assert.equal(game.chat[0].name, '朋友');
  assert.equal(game.chat[0].text, '<b>你好</b>');
  const { chat, chatSeq, ...rest } = game;
  assert.deepEqual(rest, before);
  assert.deepEqual(viewFor(game, 'host').chat, chat);
  act(game, 'guest', { type: 'rename', name: '新名字' });
  assert.equal(game.chat[0].name, '朋友');
  for (const text of ['', ' ', 'x'.repeat(301), {}]) assert.throws(() => act(game, 'guest', { type: 'chat', text }));
  assert.throws(() => act(game, 'outsider', { type: 'chat', text: '非法消息' }));
});
test('chat limits bursts and retains only the latest 100 messages', t => {
  const game = room();
  let now = 10000;
  t.mock.method(Date, 'now', () => now);
  for (let i = 0; i < 5; i++) act(game, 'guest', { type: 'chat', text: String(i) });
  assert.throws(() => act(game, 'guest', { type: 'chat', text: 'too fast' }));
  for (let i = 0; i < 105; i++) {
    now += 5001;
    act(game, 'guest', { type: 'chat', text: String(i) });
  }
  assert.equal(game.chat.length, 100);
  assert.equal(game.chatSeq, 110);
  assert.equal(game.chat[0].seq, 11);
});
test('new human seats require unique supplied names including offline and bot seats', () => {
  const game = room();
  game.players[1].online = false;
  assert.throws(() => addPlayer(game, 'new', '朋友'), /已被使用/);
  assert.throws(() => act(game, 'host', { type: 'rename', name: '机器人' }), /已被使用/);
  assert.throws(() => act(game, 'host', { type: 'rename', name: '朋友' }), /已被使用/);
  assert.throws(() => addPlayer(game, 'auto', '朋友', false, true), /已被使用/);
  for (const automatic of [false, true]) assert.throws(() => addPlayer(game, 'empty', '', false, automatic), /昵称/);
  addPlayer(game, 'auto', '自选昵称', false, true);
  assert.equal(new Set(game.players.map(p => p.name)).size, game.players.length);
  assert.equal(game.players.find(p => p.id === 'auto').name, '自选昵称');
  assert.equal(game.players.find(p => p.id === 'auto').automaticName, false);
  act(game, 'auto', { type: 'rename', name: '换个新名' });
  assert.equal(game.players.find(p => p.id === 'auto').automaticName, false);
});
test('automatic bot names remain unique across removal and replacement', () => {
  const game = room();
  for (let i = 0; i < 12; i++) {
    const id = `bot${i}`;
    addPlayer(game, id, '机器人', true, true);
    assert.equal(new Set(game.players.map(p => p.name)).size, game.players.length);
    game.players = game.players.filter(p => p.id !== id);
  }
});

test('practice and online bot creation share naming, reserve offline names, and never consume deal randomness', () => {
  const practice = createGame();
  addPlayer(practice, 'host', BOT_NAMES[0]);
  addPlayer(practice, 'guest', BOT_NAMES[1]);
  practice.players[1].online = false;
  const online = new RoomAuthority(undefined, 100000);
  const host = online.join('host-hash', { host: true, name: BOT_NAMES[0] }, 100000);
  const guest = online.join('guest-hash', { name: BOT_NAMES[1] }, 100000);
  online.disconnect(guest.id, 100000);
  const identities = structuredClone(online.record.identities);
  for (const g of [practice, online.game]) {
    const randomState = structuredClone(g.randomState);
    for (let i = 0; i < 4; i++) {
      if (g === practice) addPlayer(g, `bot${i}`, '', true, true);
      else online.handle(host, { type: 'addbot' }, 100000);
    }
    assert.deepEqual(g.randomState, randomState);
    assert.equal(new Set(g.players.map(p => p.id)).size, 6);
    assert.equal(new Set(g.players.map(p => p.name)).size, 6);
    assert.equal(new Set(g.players.map(p => [...p.name][0])).size, 6);
    for (const p of g.players.filter(p => p.bot)) {
      assert.ok(BOT_NAMES.includes(p.name));
      assert.equal(p.automaticName, true);
    }
  }
  assert.deepEqual(online.record.identities, identities, 'bot nicknames never create authentication entries');
  const names = online.game.players.map(p => p.name);
  const restored = new RoomAuthority(structuredClone(online.record), 100001);
  const rejoined = restored.join('host-hash', { host: true, name: '', automaticName: true }, 100001);
  assert.equal(rejoined.id, host.id);
  for (const view of [restored.view(rejoined, 0, 100001), restored.view(guest, 0, 100001), spectatorView(restored.game)]) {
    assert.deepEqual(view.players.map(p => p.name), names);
  }
  assert.deepEqual(restored.record.identities, identities);
});

test('saved new and legacy names, IDs and chat remain stable through restore and the next round', () => {
  const game = createGame();
  addPlayer(game, 'host', '真人-9yce');
  addPlayer(game, 'legacy', '旧机器人-9yce', true);
  game.players[1].automaticName = true; // A stored old bot, not a new default bot.
  addPlayer(game, 'new-bot', '', true, true);
  game.chat = [{ seq: 1, player: 'host', name: '旧聊天名-9yce', text: '历史消息', time: 1 }];
  const identities = game.players.map(({ id, name }) => ({ id, name }));
  const restored = normalizeGame(JSON.parse(JSON.stringify(game)));
  act(restored, 'host', { type: 'start' });
  for (let step = 0; restored.round < 2 && step < 50; step++) {
    if (['trickEnd', 'roundEnd'].includes(restored.phase)) act(restored, 'host', { type: 'next' });
    else {
      const player = restored.players[restored.turn], view = viewFor(restored, player.id);
      const action = restored.phase === 'trump' ? { type: 'trump', suit: 'blue' }
        : restored.phase === 'bid' ? { type: 'bid', value: view.bids[0] } : { type: 'play', card: view.legal[0] };
      act(restored, player.id, action);
    }
  }
  assert.equal(restored.round, 2);
  assert.deepEqual(restored.players.map(({ id, name }) => ({ id, name })), identities);
  assert.deepEqual(restored.chat, game.chat);
  assert.deepEqual(viewFor(restored, 'host').players.map(p => p.name), identities.map(p => p.name));
});
test('all trump colors, white no-trump, and pending selection are distinct states', () => {
  for (const suit of ['blue', 'red', 'green', 'yellow']) {
    assert.deepEqual(trumpStyle({ trump: suit, phase: 'bid' }), { suit, color: TRUMP_COLORS[suit], pending: false });
  }
  assert.deepEqual(trumpStyle({ trump: null, phase: 'bid' }), { suit: 'none', color: '#ffffff', pending: false });
  assert.equal(trumpStyle({ trump: null, phase: 'trump' }).pending, true);
});
