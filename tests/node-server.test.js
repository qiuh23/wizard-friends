import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import { createServer } from '../server/index.js';
import { RoomStore } from '../server/storage.js';
import { RoomAuthority } from '../worker/room-authority.js';
import { DEFAULT_OPTIONS } from '../src/rules-options.js';

const room = 'ABCDEFGH';
const origin = 'http://192.0.2.10:8081';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(callback, message = 'condition', timeout = 4000) {
  const end = Date.now() + timeout;
  do { const result = callback(); if (result) return result; await delay(10); } while (Date.now() < end);
  throw new Error(`Timed out waiting for ${message}`);
}
async function fixture(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'wizard-node-'));
  await writeFile(join(directory, 'index.html'), '<html>same-origin application</html>');
  await writeFile(join(directory, 'build-info.json'), JSON.stringify({ revision: 'a'.repeat(40), relay: 'https://obsolete-cloudflare.example' }));
  const config = { host: '127.0.0.1', port: 0, publicOrigin: origin, staticDir: directory, databasePath: join(directory, 'rooms.sqlite'), onError() {}, ...options };
  let app = await createServer(config), address = await app.listen();
  const f = { directory, config, get app() { return app; }, get base() { return `http://127.0.0.1:${address.port}`; },
    async restart() { await app.close(); app = await createServer(config); address = await app.listen(); },
  };
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  return f;
}
async function connect(f, { host = false, token = crypto.randomUUID(), name = host ? '房主' : '访客', spectator = false, path = `/api/rooms/${room}/ws`, hello = true } = {}) {
  const socket = new WebSocket(f.base.replace('http:', 'ws:') + path, { origin });
  const messages = [];
  const client = { socket, token, host, name, spectator, messages, closed: null,
    get state() { return messages.findLast(message => message.data?.type === 'state')?.data.state; },
    get id() { return messages.findLast(message => message.data?.type === 'state')?.data.me; },
    send(data) { socket.send(JSON.stringify({ type: 'send', data })); },
    async action(action, requestId) { const previous = messages.length; this.send({ type: 'action', action, ...(requestId ? { requestId } : {}) }); await until(() => messages.slice(previous).some(value => value.data), 'action response'); },
  };
  socket.on('message', data => { const text = data.toString(); messages.push(text === 'pong' ? text : JSON.parse(text)); });
  socket.on('close', code => { client.closed = code; });
  socket.on('error', () => {});
  await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
  if (hello) {
    socket.send(JSON.stringify(path === '/api/presence' ? { type: 'hello', visitor: token } : { type: 'hello', version: 2, host, token, name, spectator }));
    await until(() => client.state || client.closed || messages.some(message => message.type === 'fatal'), 'handshake');
  }
  return client;
}
async function three(f) {
  const clients = [await connect(f, { host: true }), await connect(f, { name: '小满' }), await connect(f, { name: '阿蓝' })];
  await until(() => clients.every(client => client.state.players.length === 3));
  return clients;
}
async function startRound(clients) {
  const host = clients[0];
  await host.action({ type: 'configure', options: { ...DEFAULT_OPTIONS, short: true, predictionMode: 'secret', foresight: false } });
  await host.action({ type: 'start' });
  if (host.state.phase === 'trump') await clients.find(client => client.id === host.state.players[host.state.turn].id).action({ type: 'trump', suit: 'blue' });
  while (host.state.phase === 'bid') {
    const client = clients.find(candidate => candidate.state.canBid);
    await client.action({ type: 'bid', value: client.state.bids[0] });
    await until(() => clients.every(candidate => candidate.state.phase === host.state.phase), 'matching phase');
  }
}

test('Node serves its own assets/config and a nonmutating versioned WebSocket probe', async t => {
  const f = await fixture(t);
  assert.match(await (await fetch(f.base)).text(), /same-origin application/);
  assert.deepEqual(await (await fetch(`${f.base}/api/health`)).json(), { transport: 'node-websocket', version: 2, revision: 'a'.repeat(40) });
  const runtime = await (await fetch(`${f.base}/runtime-config.json`)).json();
  assert.equal(runtime.backendId, 'aliyun'); assert.equal(runtime.relayOrigin, '');
  assert.equal(runtime.backends.find(backend => backend.id === 'aliyun').enabled, false);
  assert.equal(runtime.backends.find(backend => backend.id === 'aliyun').origin, origin);
  const probe = await connect(f, { path: '/api/connectivity/ws', hello: false });
  await until(() => probe.messages.length && probe.closed === 1000);
  assert.equal(probe.messages[0].revision, 'a'.repeat(40));
  assert.equal(f.app.store.all().length, 0, 'probe never creates a room');
  await assert.rejects(createServer({ ...f.config, env: { RELEASE_SHA: 'b'.repeat(40) } }), /does not match/);
  await assert.rejects(createServer({ ...f.config, env: { BACKENDS_CONFIG_JSON: JSON.stringify([{ id: 'aliyun', origin, enabled: 'yes' }]) } }), /配置无效/);
  await assert.rejects(createServer({ ...f.config, staticDir: join(f.directory, 'missing'), env: { NODE_ENV: 'production', RELEASE_SHA: 'a'.repeat(40) } }), /frontend full verified/);
  const rejected = new WebSocket(f.base.replace('http:', 'ws:') + '/api/presence', { origin: 'http://evil.example' });
  assert.match((await new Promise(resolve => rejected.once('error', resolve))).message, /403/);
});

test('real three-client round, chat, spectator privacy, request deduplication and ownership', async t => {
  const f = await fixture(t), clients = await three(f), [host, guest] = clients;
  const spectator = await connect(f, { name: '观众', spectator: true });
  await startRound(clients);
  assert.equal(host.state.phase, 'play');
  await until(() => spectator.state?.phase === 'play');
  for (const client of clients) {
    assert.equal(client.state.players.filter(player => Array.isArray(player.hand)).length, 1);
    assert.equal(client.state.randomState, undefined); assert.equal(client.state.identities, undefined);
  }
  assert.ok(spectator.state.players.every(player => !Object.hasOwn(player, 'hand') && player.bid === null));
  spectator.send({ type: 'pause' });
  await until(() => spectator.messages.some(message => message.data?.type === 'error'));
  assert.equal(host.state.lifecycle.paused, false);
  await guest.action({ type: 'chat', text: '同源聊天' }, 'chat-retry');
  await guest.action({ type: 'chat', text: '同源聊天' }, 'chat-retry');
  assert.equal(guest.state.chat.filter(message => message.text === '同源聊天').length, 1);
  const impostor = await connect(f, { host: true, name: '冒充房主' });
  assert.ok(impostor.messages.some(message => message.type === 'fatal' && /另一位房主/.test(message.message)));
  for (let i = 0; i < 3; i++) {
    const current = clients.find(client => client.id === host.state.players[host.state.turn].id);
    const seq = host.state.eventSeq;
    await current.action({ type: 'play', card: current.state.legal[0] }, `play-${i}`);
    await until(() => host.state.eventSeq > seq);
  }
  assert.equal(host.state.phase, 'roundEnd'); assert.equal(host.state.history.length, 1);
  const disk = f.app.store.all()[0][1];
  assert.equal(disk.authority.game.history.length, 1);
  assert.equal(disk.authority.requests.filter(receipt => receipt.key.endsWith(':chat-retry')).length, 1);
  assert.ok(disk.owner && disk.authority.identities && disk.authority.game.randomState);
  assert.equal(spectator.state.players.some(player => Object.hasOwn(player, 'hand')), false);
});

test('SQLite restart preserves identities, exact paused hands/random stream, deadline budget, chat and closed tombstones', async t => {
  const f = await fixture(t), clients = await three(f), [host, guest] = clients;
  await startRound(clients);
  host.send({ type: 'pause' }); await until(() => host.state.lifecycle.paused);
  await guest.action({ type: 'chat', text: '重启前' }, 'persisted-chat');
  const before = structuredClone(f.app.store.all()[0][1].authority);
  const identities = clients.map(client => ({ host: client.host, token: client.token, name: '', id: client.id }));
  await f.restart();
  const after = f.app.store.all()[0][1].authority;
  assert.deepEqual(after.game.players.map(player => player.hand), before.game.players.map(player => player.hand));
  assert.deepEqual(after.game.randomState, before.game.randomState);
  assert.deepEqual(after.identities, before.identities); assert.equal(after.hostId, before.hostId);
  assert.deepEqual(after.frozen, before.frozen); assert.equal(after.lifecycle.paused, true);
  assert.ok(f.app.contexts.get(room).record.alarm, 'restart reinstalls retention alarm without a reconnect');
  const resumed = [];
  for (const identity of identities) { const client = await connect(f, identity); resumed.push(client); assert.equal(client.id, identity.id); }
  await resumed[1].action({ type: 'chat', text: '重启前' }, 'persisted-chat');
  assert.equal(resumed[1].state.chat.filter(message => message.text === '重启前').length, 1);
  resumed[0].send({ type: 'resume' }); await until(() => !resumed[0].state.lifecycle.paused);
  const remaining = resumed[0].state.turnDeadline - Date.now();
  assert.ok(remaining <= before.frozen.remaining && remaining > before.frozen.remaining - 1000);
  resumed[0].send({ type: 'dissolve' }); await until(() => resumed[0].messages.some(message => message.type === 'fatal'));
  assert.equal(f.app.store.all()[0][1].closed, true);
  await f.restart();
  const closed = await connect(f, identities[0]);
  assert.ok(closed.messages.some(message => message.type === 'fatal' && /关闭/.test(message.message)));
  assert.equal(f.app.store.all()[0][1].authority.lifecycle.closed, true);
});

test('last effective connection controls offline status; heartbeat and frame limits retain Worker semantics', async t => {
  const f = await fixture(t), host = await connect(f, { host: true });
  const second = await connect(f, { host: true, token: host.token, name: '' });
  host.socket.close(); await until(() => host.closed !== null);
  await until(() => [...f.app.contexts.get(room).sockets].length === 1);
  assert.equal(f.app.contexts.get(room).controller.authority.hostOnline(), true);
  second.socket.send('ping'); await until(() => second.messages.includes('pong'));
  const third = await connect(f, { host: true, token: host.token, name: '' });
  const context = f.app.contexts.get(room);
  const stale = [...context.sockets].find(ws => ws.data.authenticated && ws.heartbeat);
  stale.data.created = stale.data.lastSeen = stale.heartbeat = Date.now() - 80000;
  await context.execute(() => context.controller.alarm());
  await until(() => second.closed === 1012);
  assert.equal(context.controller.authority.hostOnline(), true, 'a stale socket cannot disconnect another live connection for the same identity');
  third.socket.terminate();
  await until(() => !f.app.contexts.get(room).controller.authority.hostOnline());
  const deadline = f.app.store.all()[0][1].authority.lifecycle.retentionDeadline;
  assert.ok(deadline > Date.now());
  const invalid = await connect(f, { hello: false });
  invalid.socket.send('x'.repeat(262145)); await until(() => invalid.closed === 1009);
  const binary = await connect(f, { hello: false });
  binary.socket.send(Buffer.from('{}')); await until(() => binary.closed === 1009);
});

test('failed SQLite commits send no ready/state success and roll back in-memory state before reconnect', async t => {
  const store = new RoomStore(':memory:');
  const save = store.save.bind(store); let fail = true;
  store.save = (id, record) => { if (fail) throw new Error('disk full'); save(id, record); };
  const f = await fixture(t, { store });
  const rejected = await connect(f, { host: true });
  assert.equal(rejected.closed, 1011);
  assert.equal(rejected.messages.length, 0);
  assert.equal(store.all().length, 0);
  fail = false;
  const host = await connect(f, { host: true, token: rejected.token });
  assert.ok(host.state);
  const before = store.all()[0][1];
  fail = true;
  const marker = host.messages.length;
  host.send({ type: 'action', requestId: 'failed-chat', action: { type: 'chat', text: '不能确认的消息' } });
  await until(() => host.closed === 1011);
  assert.equal(host.messages.length, marker, 'uncommitted snapshots cannot reach clients');
  assert.deepEqual(store.all()[0][1], before);
  fail = false;
  const returning = await connect(f, { host: true, token: host.token, name: '' });
  assert.equal(returning.id, host.id);
  assert.equal((returning.state.chat || []).some(message => message.text === '不能确认的消息'), false);
});

test('an actual killed Node process recovers the same paused three-player room and credentials', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'wizard-process-'));
  await writeFile(join(directory, 'index.html'), '<html>restart fixture</html>');
  let child;
  async function launch() {
    child = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, NODE_ENV: 'test', HOST: '127.0.0.1', PORT: '0', PUBLIC_ORIGIN: origin,
      DATABASE_PATH: join(directory, 'rooms.sqlite'), STATIC_DIR: directory, RELEASE_SHA: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', errors = ''; child.stdout.on('data', data => { output += data; }); child.stderr.on('data', data => { errors += data; });
    await until(() => /listening at 127\.0\.0\.1:(\d+)/.exec(output), `child startup ${errors}`);
    const port = /listening at 127\.0\.0\.1:(\d+)/.exec(output)[1];
    return { base: `http://127.0.0.1:${port}` };
  }
  async function kill() {
    if (!child || child.exitCode !== null) return;
    const exited = new Promise(resolve => child.once('exit', resolve)); child.kill('SIGKILL'); await exited;
  }
  t.after(async () => { await kill(); await rm(directory, { recursive: true, force: true }); });
  let f = await launch();
  const clients = await three(f); await startRound(clients);
  clients[0].send({ type: 'pause' }); await until(() => clients.every(client => client.state.lifecycle.paused));
  await clients[1].action({ type: 'chat', text: '进程终止前已确认' });
  const before = clients.map(client => ({ id: client.id, token: client.token, host: client.host,
    hand: client.state.players.find(player => player.id === client.id).hand, remaining: client.state.lifecycle.remainingMs }));
  await kill();
  f = await launch();
  for (const identity of before) {
    const restored = await connect(f, { ...identity, name: '' });
    assert.equal(restored.id, identity.id);
    assert.deepEqual(restored.state.players.find(player => player.id === restored.id).hand, identity.hand);
    assert.equal(restored.state.lifecycle.paused, true);
    assert.equal(restored.state.lifecycle.remainingMs, identity.remaining);
    assert.equal(restored.state.chat.at(-1).text, '进程终止前已确认');
  }
});

test('startup restores expiration alarms without clients and closes expired rooms permanently', async t => {
  const store = new RoomStore(':memory:'), authority = new RoomAuthority();
  const host = authority.join('owner-hash', { host: true, name: '计时房主' });
  authority.disconnect(host.id);
  authority.life.retentionDeadline = Date.now() + 120;
  authority.record.alarmAt = authority.life.retentionDeadline;
  store.save(room, { room, owner: 'owner-hash', authority: authority.record, alarm: authority.life.retentionDeadline });
  const f = await fixture(t, { store });
  assert.equal(store.all()[0][1].authority.lifecycle.closed, false);
  await until(() => store.all()[0][1].closed === true, 'restored expiration alarm');
  assert.equal(f.app.contexts.get(room).record.alarm, undefined);
});
