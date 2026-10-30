import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { RoomRelay, RoomDirectory } from '../worker/index.js';
import { RoomAuthority } from '../worker/room-authority.js';
import { RoomStore } from './storage.js';
import { normalizeRuntimeConfig } from '../src/backend-entry.js';

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg' };
const clone = value => structuredClone(value);
const json = (response, value, status = 200) => { response.writeHead(status, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' }); response.end(JSON.stringify(value)); };

class Socket {
  constructor(raw, context, metadata) { this.raw = raw; this.context = context; this.data = { ...metadata, created: Date.now() }; this.heartbeat = 0; }
  serializeAttachment(value) { this.data = clone(value); }
  deserializeAttachment() { return clone(this.data); }
  send(value) { this.context.output(() => { if (this.raw.readyState === WebSocket.OPEN) this.raw.send(value); }); }
  close(code = 1000, reason = '') { this.context.output(() => { if (this.raw.readyState < WebSocket.CLOSING) this.raw.close(code, reason); }); }
}

// A small platform adapter for the existing Worker controllers. Storage and
// socket effects are staged until the complete room event is durably saved.
// Queues are per-room; SQLite's single upsert never spans an asynchronous wait.
class Context {
  constructor(id, store, record = {}, onError = console.error) {
    this.id = id; this.store = store; this.record = clone(record); this.sockets = new Set(); this.queue = Promise.resolve(); this.onError = onError;
    this.storage = {
      get: async key => clone(this.current()[key]),
      put: async (key, value) => { const entries = typeof key === 'object' ? Object.entries(key) : [[key, value]]; for (const [k, v] of entries) this.current()[k] = clone(v); },
      delete: async key => delete this.current()[key],
      list: async ({ prefix }) => new Map(Object.entries(this.current()).filter(([key]) => key.startsWith(prefix)).map(([key, value]) => [key, clone(value)])),
      setAlarm: async at => { this.current().alarm = at; },
      deleteAlarm: async () => { delete this.current().alarm; },
    };
  }
  current() { return this.staged || this.record; }
  getWebSockets() { return [...this.sockets]; }
  setWebSocketAutoResponse() {}
  getWebSocketAutoResponseTimestamp(ws) { return ws.heartbeat ? new Date(ws.heartbeat) : null; }
  blockConcurrencyWhile(callback) { return callback(); }
  output(effect) { if (this.effects) this.effects.push(effect); else effect(); }
  afterCommit(effect) { if (this.followups) this.followups.push(effect); else effect(); }
  execute(callback) {
    const operation = this.queue.then(async () => {
      this.staged = clone(this.record); this.effects = []; this.followups = [];
      const attachments = new Map([...this.sockets].map(ws => [ws, clone(ws.data)]));
      try {
        await callback();
        if (this.store) this.store.save(this.id, this.staged);
        this.record = this.staged;
        const effects = this.effects, followups = this.followups;
        this.staged = this.effects = this.followups = null;
        this.schedule();
        for (const effect of effects) effect();
        for (const effect of followups) await effect();
      } catch (error) {
        this.staged = this.effects = this.followups = null;
        for (const [ws, data] of attachments) ws.data = data;
        if (this.controller instanceof RoomRelay) {
          this.controller.authority = this.record.authority ? new RoomAuthority(clone(this.record.authority)) : null;
          this.controller.pendingOwner = null;
          for (const player of this.controller.authority?.game.players || []) {
            if (player.online && !player.bot) this.controller.authority.disconnect(player.id);
          }
        }
        this.schedule();
        this.onError(error);
        // No success, state or ready message from a failed commit is sent.
        // Mark discarded sockets removed to prevent their close event from
        // mutating the restored record while persistence is unavailable.
        for (const ws of this.sockets) { ws.data.removed = true; ws.raw.close(1011, 'Persistence unavailable'); }
        throw error;
      }
    });
    this.queue = operation.catch(() => {});
    return operation;
  }
  schedule() {
    clearTimeout(this.timer);
    if (this.stopping || !this.record.alarm) return;
    this.timer = setTimeout(() => this.execute(() => this.controller.alarm()).catch(() => {}), Math.min(2147483647, Math.max(1, this.record.alarm - Date.now())));
    this.timer.unref();
  }
}

export async function createServer(options = {}) {
  if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('Wizard Friends Node backend requires Node.js 24 or later.');
  const env = options.env || process.env;
  const host = options.host ?? env.HOST ?? '127.0.0.1';
  const port = options.port ?? Number(env.PORT || 3002);
  const publicOrigin = options.publicOrigin || env.PUBLIC_ORIGIN || `http://${host}:${port}`;
  const origin = new URL(publicOrigin);
  if (!['http:', 'https:'].includes(origin.protocol) || origin.origin !== publicOrigin || origin.username || origin.password) throw new Error('PUBLIC_ORIGIN must be an exact http(s) origin including its public port.');
  if (env.NODE_ENV === 'production' && !env.PUBLIC_ORIGIN && !options.publicOrigin) throw new Error('PUBLIC_ORIGIN is required in production.');
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid PORT');
  const staticDir = resolve(options.staticDir || env.STATIC_DIR || 'dist');
  let build = {};
  try { build = JSON.parse(await readFile(resolve(staticDir, 'build-info.json'), 'utf8')); } catch {}
  if (env.RELEASE_SHA && build.revision && env.RELEASE_SHA !== build.revision) throw new Error('RELEASE_SHA does not match the installed frontend revision.');
  const revision = build.revision || env.RELEASE_SHA || 'development';
  if (env.NODE_ENV === 'production') {
    if (!/^[a-f0-9]{40}$/.test(build.revision || '')) throw new Error('Production requires the frontend full verified build revision.');
    if (!(await stat(resolve(staticDir, 'index.html'))).isFile()) throw new Error('Production frontend is missing.');
  }
  const health = { transport: 'node-websocket', version: 2, revision };
  let backends = [{ id: 'cloudflare', origin: 'https://wizard-friends.qiuh23.workers.dev', enabled: true }, { id: 'aliyun', origin: publicOrigin, enabled: false }];
  if (env.BACKENDS_CONFIG_JSON) { const config = JSON.parse(env.BACKENDS_CONFIG_JSON); backends = Array.isArray(config) ? config : config.backends; }
  const runtimeConfig = normalizeRuntimeConfig({ backendId: 'aliyun', relayOrigin: '', backends }, publicOrigin);
  if (runtimeConfig.backends.find(backend => backend.id === 'aliyun').origin !== publicOrigin) throw new Error('The Aliyun entry must match PUBLIC_ORIGIN.');
  const store = options.store || new RoomStore(options.databasePath || env.DATABASE_PATH || 'var/rooms.sqlite');
  const contexts = new Map();
  const directoryContext = new Context('directory', null, {}, options.onError);
  const directory = new RoomDirectory(directoryContext); directoryContext.controller = directory;
  const relayEnv = { DIRECTORY: { getByName: () => ({ fetch: async (url, init) => {
    const value = JSON.parse(init.body);
    const context = contexts.get(value.room);
    context.afterCommit(() => directoryContext.execute(() => directory.fetch(new Request(url, init))));
    return Response.json({ ok: true });
  } }) } };
  function roomContext(id, record) {
    if (contexts.has(id)) return contexts.get(id);
    const context = new Context(id, store, record, options.onError);
    contexts.set(id, context); context.controller = new RoomRelay(context, relayEnv);
    return context;
  }
  for (const [id, record] of store.all()) roomContext(id, record);
  // Recover alarms and presence for every saved active room, including rooms
  // that no browser reconnects to. Tombstones remain in SQLite indefinitely.
  for (const context of contexts.values()) {
    await context.controller.initialized;
    if (context.controller.authority && !context.controller.authority.closed) await context.execute(() => context.controller.alarm());
  }
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, publicOrigin);
      if (!['GET', 'HEAD'].includes(request.method)) return json(response, { error: 'Method not allowed' }, 405);
      if (url.pathname === '/api/health') return json(response, health);
      if (url.pathname === '/runtime-config.json') return json(response, runtimeConfig);
      if (url.pathname.startsWith('/api/')) return json(response, { error: 'WebSocket required' }, 426);
      let path;
      try { path = resolve(staticDir, `.${decodeURIComponent(url.pathname)}`); } catch { return json(response, { error: 'Invalid path' }, 400); }
      if (path !== staticDir && !path.startsWith(`${staticDir}${sep}`)) return json(response, { error: 'Not found' }, 404);
      try { if ((await stat(path)).isDirectory()) path = resolve(path, 'index.html'); }
      catch { if (!extname(url.pathname)) path = resolve(staticDir, 'index.html'); }
      const data = await readFile(path);
      response.writeHead(200, { 'Content-Type': MIME[extname(path)] || 'application/octet-stream', 'Cache-Control': extname(path) === '.html' || extname(path) === '.json' ? 'no-store' : 'public, max-age=3600' });
      response.end(request.method === 'HEAD' ? undefined : data);
    } catch (error) { if (!response.headersSent) json(response, { error: error.code === 'ENOENT' ? 'Not found' : 'Request failed' }, error.code === 'ENOENT' ? 404 : 500); else response.destroy(); }
  });
  const websocket = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024, perMessageDeflate: false });
  const presenceTimer = setInterval(() => directoryContext.execute(async () => {
    for (const ws of directoryContext.sockets) if (Date.now() - Math.max(ws.heartbeat, ws.data.created) > 75000) {
      ws.data.removed = true; ws.close(1012, 'Heartbeat timeout');
    }
    await directory.publish();
  }).catch(() => {}), 30000);
  presenceTimer.unref();
  server.on('upgrade', (request, socket, head) => {
    const reject = (status, message) => { socket.end(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\n\r\n`); };
    let url;
    try { url = new URL(request.url, publicOrigin); } catch { return reject(400, 'Bad Request'); }
    const allowed = new Set([publicOrigin, ...(env.ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean)]);
    if (request.headers.origin && !allowed.has(request.headers.origin)) return reject(403, 'Forbidden');
    if (url.pathname === '/api/connectivity/ws') {
      return websocket.handleUpgrade(request, socket, head, raw => { raw.send(JSON.stringify({ type: 'probe', ...health })); raw.close(1000); });
    }
    const match = /^\/api\/rooms\/([A-Z2-9]{8})\/ws$/.exec(url.pathname);
    const context = url.pathname === '/api/presence' ? directoryContext : match ? roomContext(match[1]) : null;
    if (!context) return reject(404, 'Not Found');
    if ([...context.sockets].filter(ws => !ws.data.removed).length >= (context === directoryContext ? 1000 : 64)) return reject(429, 'Too Many Requests');
    websocket.handleUpgrade(request, socket, head, raw => {
      const ws = new Socket(raw, context, match ? { room: match[1], id: crypto.randomUUID() } : {});
      context.sockets.add(ws);
      const authTimer = setTimeout(() => { if (!ws.data.authenticated) raw.close(1008, 'Authentication timeout'); }, 10000); authTimer.unref();
      raw.on('message', (data, binary) => {
        if (binary) return raw.close(1009, 'Text frames required');
        const text = data.toString();
        if (text === 'ping') { ws.heartbeat = Date.now(); return raw.send('pong'); }
        context.execute(() => context.controller.webSocketMessage(ws, text)).catch(() => {});
      });
      raw.on('close', () => { clearTimeout(authTimer); context.execute(() => context.controller.webSocketClose(ws)).catch(() => {}).finally(() => context.sockets.delete(ws)); });
      // ws already sends the appropriate protocol close (for example 1009
      // for oversized frames). Terminating here would hide that close code.
      raw.on('error', () => {});
    });
  });
  return {
    server, store, contexts, health,
    async listen() { await new Promise((resolveListen, reject) => { server.once('error', reject); server.listen(port, host, () => { server.removeListener('error', reject); resolveListen(); }); }); return server.address(); },
    async close() {
      clearInterval(presenceTimer);
      for (const context of [...contexts.values(), directoryContext]) { context.stopping = true; clearTimeout(context.timer); }
      for (const raw of websocket.clients) raw.terminate();
      await new Promise(resolveClose => server.close(resolveClose));
      for (const context of [...contexts.values(), directoryContext]) await context.queue;
      websocket.close(); store.close();
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const application = await createServer();
  const address = await application.listen();
  console.log(`Wizard Friends listening at ${address.address}:${address.port}; revision ${application.health.revision}`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => application.close().then(() => process.exit(0), error => { console.error(error); process.exit(1); }));
}
