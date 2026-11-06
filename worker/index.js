import { assignNickname, enforceRequest, migrateCNGame, normalizeEdition, serverEdition, CN_NICKNAMES } from '../src/site-policy.js';
import { adminAuthorized, recordSecurity, securityCall, applyModeration, DEFAULT_CONTACT, ConnectionGuard } from './security.js';
export { SecurityLedger } from './security.js';
import { publicRoom, publicRooms } from '../src/public-room.js';
import { RoomAuthority, RECONNECT_GRACE_MS } from './room-authority.js';

const cnConnections = new ConnectionGuard();
const artifactChecks = new WeakMap();
async function checkedArtifact(env, edition, url) {
  if (!artifactChecks.has(env)) artifactChecks.set(env, (async () => {
    const response = await env.ASSETS.fetch(new Request(new URL('/build-info.json', url)));
    if (!response.ok || (await response.json()).siteEdition !== edition) throw Error('Frontend and Worker SITE_EDITION mismatch');
  })());
  return artifactChecks.get(env);
}
const uuid = value => typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value);
const MAX_FRAME = 256 * 1024;
const DIRECTORY_TTL = 90000;
const json = (value, status = 200) => Response.json(value, { status });
const send = (ws, value) => { try { ws.send(JSON.stringify(value)); } catch {} };
const close = (ws, code = 1000, reason = '') => { try { ws.close(code, reason); } catch {} };
const attachment = ws => ws.deserializeAttachment() || {};
async function fingerprint(token) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(hash), n => n.toString(16).padStart(2, '0')).join('');
}
function accept(ctx, metadata) {
  const pair = new WebSocketPair();
  ctx.acceptWebSocket(pair[1]);
  pair[1].serializeAttachment({ ...metadata, created: Date.now() });
  // Unauthenticated sockets must not occupy room slots indefinitely.
  setTimeout(() => { if (!attachment(pair[1]).authenticated) close(pair[1], 1008, 'Authentication timeout'); }, 10000);
  return new Response(null, { status: 101, webSocket: pair[0] });
}
function parse(raw) {
  if (typeof raw !== 'string' || raw.length > MAX_FRAME || new TextEncoder().encode(raw).length > MAX_FRAME) return null;
  try { return JSON.parse(raw); } catch { return null; }
}
export default {
  async fetch(request, env) {
    let edition; try { edition = normalizeEdition(env.SITE_EDITION); } catch { return json({ error: 'SITE_EDITION deployment configuration missing or invalid' }, 503); }
    const url = new URL(request.url);
    try { await checkedArtifact(env, edition, url); } catch { return json({error:'Frontend and Worker SITE_EDITION missing or mismatched'},503); }
    if(edition === 'cn' && url.pathname === '/api/security/health') return json({ok:true,auditEnabled:false});
    if(edition === 'cn' && (url.pathname.startsWith('/api/stationmaster/') || url.pathname === '/api/security/contact')) return json({error:'Not found'},404);
    if (url.pathname === '/runtime-config.json') return json({ siteEdition: edition, backendId: edition === 'cn' ? 'aliyun' : 'cloudflare', relayOrigin: '', backends: [{ id: edition === 'cn' ? 'aliyun' : 'cloudflare', origin: url.origin, enabled: true }] });
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    if(url.pathname === '/api/security/contact') return json({contact:env.REPORT_CONTACT ?? DEFAULT_CONTACT});
    if(url.pathname === '/api/security/health') { try { await securityCall(env,'health'); return json({ok:!!env.SECURITY}); } catch { return json({ok:false},503); } }
    const admin = /^\/api\/stationmaster\/rooms\/([A-Z2-9]{8})$/.exec(url.pathname);
    if(admin || url.pathname === '/api/stationmaster/security') {
      if(!(await adminAuthorized(request,env))) {await recordSecurity(env,{kind:'security.admin-denied',route:'stationmaster',outcome:'deny'}).catch(()=>{});return json({error:'Forbidden'},403);}
      if(request.method !== 'POST' || Number(request.headers.get('Content-Length') || 0)>4096) return json({error:'Invalid request'},400);
      if(admin) return env.ROOMS.getByName(admin[1]).fetch(new Request(`https://room/internal/stationmaster/${admin[1]}`,request));
      try { const input=await request.json(); if(!['list','hold'].includes(input.action)) return json({error:'Invalid action'},400); if(input.action==='hold' && (typeof input.reason!=='string' || !input.reason.trim() || input.reason.length>300)) return json({error:'Reason required'},400); if(input.action==='list') await recordSecurity(env,{kind:'admin.audit-access',action:'list',reason:'stationmaster'}); return json(await securityCall(env,input.action,input)); }catch{return json({error:'Security unavailable'},503);}
    }
    if (url.pathname === '/api/health') return json({ transport: 'cloudflare-websocket', version: 2, siteEdition: edition });
    const origin = request.headers.get('Origin');
    const allowed = new Set([url.origin, ...(env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim())]);
    if (['localhost', '127.0.0.1'].includes(url.hostname) && origin) {
      try { if (['localhost', '127.0.0.1'].includes(new URL(origin).hostname)) allowed.add(origin); } catch {}
    }
    if (origin && !allowed.has(origin)) { try{await recordSecurity(env,{kind:'security.origin-rejected',route:'api',outcome:'deny',ip:request.headers.get('CF-Connecting-IP') || ''});}catch{} return json({ error: 'Origin not allowed' }, 403); }
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return json({ error: 'WebSocket required' }, 426);
    const match = /^\/api\/rooms\/([A-Z2-9]{8})\/ws$/.exec(url.pathname);
    if (match || url.pathname==='/api/presence') { if(edition === 'cn' && !cnConnections.allow(request.headers.get('CF-Connecting-IP') || '')) return json({error:'Too Many Requests'},429); const connection=crypto.randomUUID();try{await recordSecurity(env,{kind:'network.connect',room:match?.[1] || '',connection,route:match?'room-ws':'presence-ws',ip:request.headers.get('CF-Connecting-IP') || '',outcome:'accept'});}catch(error){return json({error:'Security unavailable'},error.status || 503);}const forwarded=new Request(request);forwarded.headers.set('X-Security-Connection',connection);return match?env.ROOMS.getByName(match[1]).fetch(forwarded):env.DIRECTORY.getByName('public').fetch(forwarded); }
    return json({ error: 'Not found' }, 404);
  },
};

export class RoomRelay {
  constructor(ctx, env) {
    this.ctx = ctx; this.env = env; this.edition = serverEdition(env); this.queue = Promise.resolve();
    if (typeof WebSocketRequestResponsePair !== 'undefined') ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    this.initialized = ctx.blockConcurrencyWhile(async () => {
      const record = await ctx.storage.get('authority');
      const now = Date.now();
      // A missing socket on cold recovery was last observed at the persisted
      // checkpoint, not at service startup. Count downtime toward retention and
      // reconnect grace instead of granting a fresh budget after every restart.
      const observedAt = Number.isFinite(record?.savedAt) ? Math.max(0, Math.min(now, record.savedAt)) : now;
      this.authority = record ? new RoomAuthority(record, observedAt, this.edition) : null;
      const room=await ctx.storage.get('room');
      if(room && this.authority) applyModeration(this.authority,await securityCall(this.env,'moderation',{room}));
      if (this.authority && !this.authority.closed) {
        const connected = new Set(this.sockets().map(ws => attachment(ws).playerId));
        for (const p of this.authority.game.players) if (!p.bot && p.online && !connected.has(p.id)) this.authority.disconnect(p.id, observedAt);
        this.recoverClock(now);
        this.authority.tick(now);
      }
    });
  }
  async serial(callback) {
    await this.initialized;
    const result = this.queue.then(callback);
    this.queue = result.catch(() => {});
    return result;
  }
  sockets() { return this.ctx.getWebSockets().filter(ws => attachment(ws).authenticated && !attachment(ws).removed); }
  host() { return this.sockets().find(ws => attachment(ws).host); }
  async fetch(request) {
    await this.initialized;
    // Closed links still complete a handshake so clients receive a terminal
    // fatal message rather than retrying an opaque failed WebSocket upgrade.
    const pathname=new URL(request.url).pathname;
    if(pathname.startsWith('/internal/stationmaster/')) return this.stationmaster(request,pathname.split('/').at(-1));
    if (this.ctx.getWebSockets().filter(ws => !attachment(ws).removed).length >= 64) return json({ error: 'Room full' }, 429);
    const room = pathname.split('/')[3];
    return accept(this.ctx, { room, id: request.headers.get('X-Security-Connection') || crypto.randomUUID() });
  }
  async advertise(room, descriptor) {
    return this.env.DIRECTORY.getByName('public').fetch('https://directory/update', {
      method: 'POST', body: JSON.stringify({ room, descriptor }),
    });
  }
  remove(ws, code = 1000) {
    ws.serializeAttachment({ ...attachment(ws), removed: true }); close(ws, code);
  }
  advance(now = Date.now()) {
    if (!this.authority) return;
    // Auto-response timestamps survive hibernation and measure actual heartbeat
    // traffic. A suspended or half-open browser must not retain host presence.
    for (const ws of this.sockets()) {
      const info = attachment(ws);
      const heartbeat = this.ctx.getWebSocketAutoResponseTimestamp?.(ws)?.getTime?.() || 0;
      if (now - Math.max(info.lastSeen || info.created || now, heartbeat) > 75000) {
        this.remove(ws, 1012);
        if (!this.sockets().some(other => attachment(other).playerId === info.playerId)) this.authority.disconnect(info.playerId, now);
      }
    }
    this.recoverClock(now);
    this.authority.tick(now);
  }
  recoverClock(now) {
    const expected = this.authority.record.alarmAt;
    if (expected && now - expected > 15000) {
      // Player deadlines are absolute. Service lag must not replenish a turn's
      // bounded reconnect protection; tick() catches up with legal autoplay.
      if (this.authority.record.task) this.authority.record.task.at = Math.max(now + 450, this.authority.record.task.at + now - expected);
      this.authority.record.alarmAt = now + 8000;
    }
  }
  async deny(ws,kind,code=1008) {const info=attachment(ws);try{await recordSecurity(this.env,{kind,room:info.room,connection:info.id,outcome:'deny'});}catch{}finally{close(ws,code);}}
  async authorize(ws, message) {
    const previous=this.authority?structuredClone(this.authority.record):null;let committed=false;
    const info = attachment(ws);
    if (message?.type !== 'hello' || typeof message.host !== 'boolean' || !uuid(message.token)) return this.deny(ws,'security.auth-rejected');
    if (message.version !== 2) {
      send(ws, { type: 'fatal', message: '房间服务已更新，请在原标签页刷新后恢复旧存档；请所有成员一起更新页面。' }); return this.deny(ws,'security.auth-rejected');
    }
    if (await this.ctx.storage.get('closed') || this.authority?.closed) {
      send(ws, { type: 'fatal', message: '房间已关闭，旧链接不能重新开启牌局。' }); return close(ws, 1000);
    }
    const moderation = await securityCall(this.env,'moderation',{room:info.room});
    if(moderation?.closed){send(ws,{type:'fatal',message:'站长已关闭房间。'});return close(ws,1008);}
    await recordSecurity(this.env,{kind:'publish.join',room:info.room,connection:info.id,outcome:'attempt'});
    const hash = await fingerprint(message.token);
    if (message.host) {
      const owner = await this.ctx.storage.get('owner');
      if (owner && owner !== hash) {
        send(ws, { type: 'fatal', message: '该房间属于另一位房主，请返回首页创建新房间。' }); return this.deny(ws,'security.auth-rejected');
      }
      if (!this.authority) {
        this.authority = new RoomAuthority(undefined, Date.now(), this.edition);
        if (message.snapshot) {
          if (!owner) {
            send(ws, { type: 'fatal', message: '新房间必须由服务端创建牌局，不能导入未经登记的客户端牌局。' }); this.authority = null; return close(ws, 1008);
          }
          const source = message.snapshot;
          if (!Array.isArray(source.players) || source.players.length < 1 || source.players.length > 6 ||
              !source.players.every(p => typeof p.id === 'string' && Array.isArray(p.hand)) ||
              new Set(source.players.map(p => p.id)).size !== source.players.length || !Array.isArray(source.history)) {
            send(ws, { type: 'fatal', message: '旧牌局存档格式无效，未覆盖原始浏览器存档。' }); this.authority = null; return close(ws, 1008);
          }
          const migrated = structuredClone(source);
          // Legacy browsers were authoritative and may supply a predictable
          // stream. Preserve already-dealt cards, but seed future deals here.
          delete migrated.randomState;
          if (this.edition === 'cn') delete migrated.cnPolicyVersion; // Browser migration cannot certify its own public text.
          this.authority.record.game = migrated;
          this.authority = new RoomAuthority(this.authority.record, Date.now(), this.edition);
          this.authority.record.hostId = source.players[0].id;
          for (const [secret, id] of Object.entries(message.identities || {})) {
            if (uuid(secret) && source.players.some(p => p.id === id)) this.authority.record.identities[await fingerprint(secret)] = id;
          }
          this.authority.record.identities[hash] = source.players[0].id;
          const recoveryNow = Date.now();
          if (this.authority.game.phase === 'play' && (!Number.isFinite(this.authority.game.turnDeadline) || this.authority.game.turnDeadline <= recoveryNow)) this.authority.game.turnDeadline = recoveryNow + RECONNECT_GRACE_MS;
          this.authority.game.players.forEach(p => {
            p.online = !!p.bot;
            if (!p.bot) this.authority.record.reconnectUntil[p.id] = recoveryNow + RECONNECT_GRACE_MS;
          });
          this.authority.syncClock(recoveryNow);
        } else if (owner) {
          send(ws, { type: 'fatal', message: '此旧房间需要原房主浏览器中的完整存档才能迁移，未创建新牌局。' }); this.authority = null; return close(ws, 1008);
        }
      }
    } else if (!this.authority) return close(ws, 1013, 'Waiting for host');
    try {
      this.advance();
      const spectators = new Set(this.sockets().filter(other => attachment(other).spectator).map(other => attachment(other).playerId));
      if (message.spectator && spectators.size >= 50 && !spectators.has(`spectator:${hash}`)) throw new Error('观战人数已满。');
      const identity = this.authority.join(hash, {
        host: message.host, name: message.name || '', nicknameId: message.nicknameId, automaticName: message.automaticName === true || !message.name,
        spectator: !message.host && message.spectator === true,
      });
      if((moderation?.restricted || []).includes(identity.id)) {this.authority.disconnect(identity.id);throw Error('该成员已被站长限制。');}
      applyModeration(this.authority,moderation);
      await recordSecurity(this.env,{kind:'publish.identity',room:info.room,actor:identity.spectator?'spectator':identity.id,connection:info.id,outcome:'accept'});
      if (message.host) this.pendingOwner = hash;
      ws.serializeAttachment({ ...info, authenticated: true, playerId: identity.id, host: identity.host, spectator: identity.spectator, lastSeen: Date.now() });
      await this.persistAndPublish(info.room, () => {committed=true;send(ws, { type: 'ready', authority: true });});
    } catch (error) { if(!committed){this.authority=previous?new RoomAuthority(previous, Date.now(), this.edition):null;this.pendingOwner=null;}send(ws, { type: 'fatal', message: error.message }); await this.deny(ws,'security.auth-rejected'); }
  }
  async persistAndPublish(room, committed = () => {}) {
    if (!this.authority) return;
    applyModeration(this.authority,await securityCall(this.env,'moderation',{room}));
    this.authority.enforcePolicy();
    const now = Date.now();
    this.authority.game.chat=(this.authority.game.chat || []).filter(message=>message.time>now-7*86400000);
    this.authority.game.publicEvents=(this.authority.game.publicEvents || []).filter(event=>event.time>now-7*86400000);
    this.authority.record.requests=(this.authority.record.requests || []).filter(entry=>{try{const social=['chat','rename'].includes(JSON.parse(entry.payload).action?.type);return !social || (entry.at || 0)>now-7*86400000;}catch{return false;}});
    this.authority.record.savedAt = now;
    const g = this.authority.game;
    const activeRoom = g.phase === 'lobby' && !this.authority.hostOnline() ? null : publicRoom({ room, hostName: g.players[0]?.name, players: g.players.length,
      round: g.round, maxRounds: g.phase === 'lobby' ? 0 : g.maxRounds, phase: g.phase, spectators: 0 });
    const next = this.authority.nextAlarm(now);
    const alarm = activeRoom || this.sockets().length ? Math.min(next ?? Infinity, now + 30000) : next;
    this.authority.record.alarmAt = alarm;
    await this.ctx.storage.put({ authority: this.authority.record, room,
      ...(this.pendingOwner ? { owner: this.pendingOwner } : {}),
      ...(this.authority.closed ? { closed: true } : {}) });
    this.pendingOwner = null;
    committed();
    if (this.authority.closed) {
      for (const ws of this.sockets()) {
        send(ws, { type: 'fatal', message: this.authority.life.closeReason || '房间已关闭。' }); this.remove(ws);
      }
      await this.advertise(room, null);
      // Keep the tombstone; deleting it would let old links resurrect a closed room.
      await this.ctx.storage.put('authority', { ...this.authority.record, game: { ...this.authority.game, players: [], trick: [], chat: [], publicEvents:[],log:[],history:[],deck:[] }, identities: {},requests:[] });
      if (this.ctx.storage.deleteAlarm) await this.ctx.storage.deleteAlarm();
      return;
    }
    if (alarm) await this.ctx.storage.setAlarm(alarm);
    else if (this.ctx.storage.deleteAlarm) await this.ctx.storage.deleteAlarm();
    const sockets = this.sockets();
    const spectatorCount = new Set(sockets.filter(ws => attachment(ws).spectator).map(ws => attachment(ws).playerId)).size;
    for (const ws of sockets) {
      const info = attachment(ws);
      send(ws, { type: 'data', data: {
        type: 'state', state: this.authority.view({ id: info.playerId, spectator: info.spectator }, spectatorCount, now),
        me: info.playerId, isHost: info.host, serverNow: now, serverTime: now,
      } });
    }
    const descriptor = activeRoom ? { ...activeRoom, spectators: spectatorCount } : null;
    await this.advertise(room, descriptor);
    // The directory expires stale entries at 90s. Healthy authoritative rooms
    // refresh their descriptor without requiring a browser-host heartbeat.

  }
  async stationmaster(request,room) {
    if(!(await adminAuthorized(request,this.env))) return json({error:'Forbidden'},403);
    return this.serial(async()=>{
      try {
        const raw=await request.text(); if(raw.length>4096) return json({error:'Too large'},400);
        const input=JSON.parse(raw), action=input.action;
        const state=await securityCall(this.env,'moderation',{room}) || {};
        applyModeration(this.authority,state);
        if(action==='inspect') {
          await recordSecurity(this.env,{kind:'admin.inspect',room,reason:'stationmaster lookup'});
          return json({room,closed:!!state.closed || !!this.authority?.closed,players:(this.authority?.game.players || []).map(({id,name})=>({id,name})),chat:this.authority?.game.chat || [],publicEvents:(this.authority?.game.publicEvents || []).map(({seq,time,text})=>({seq,time,text})),moderation:state});
        }
        if(!['hide-chat','hide-name','restrict-member','close-room'].includes(action) || typeof input.reason!=='string' || !input.reason.trim() || input.reason.length>300) return json({error:'Action and reason required'},400);
        if(!this.authority) return json({error:'Room not found'},404);
        const event={kind:'admin.moderation',room,action,reason:input.reason};
        if(action==='hide-chat') {
          const message=this.authority.game.chat?.find(message=>message.seq===input.seq);
          if(!message) return json({error:'Content not found'},404);
          event.seq=input.seq; event.content=message.text; event.memberId=message.player;
          state.hiddenChat=[...new Set([...(state.hiddenChat || []),input.seq])];
          // Legacy events predate source IDs; remove only matching chat publications.
          state.hiddenEvents=[...new Set([...(state.hiddenEvents || []),...(this.authority.game.publicEvents || []).filter(entry=>entry.source?.chatSeq===input.seq || entry.text===`${message.name} 发送消息：${message.text}`.slice(0,300)).map(entry=>entry.seq)])];
        }
        if(['hide-name','restrict-member'].includes(action)) {
          const member=this.authority.game.players.find(member=>member.id===input.memberId);
          if(!member) return json({error:'Member not found'},404);
          event.memberId=member.id;
          if(action==='restrict-member') state.restricted=[...new Set([...(state.restricted || []),member.id])];
          else { event.content=member.name;state.nameRedactionAt=Date.now();state.names={...(state.names || {}),[member.id]:this.edition === 'cn' ? assignNickname(member,[...this.authority.game.players,...Object.values(this.authority.game.spectatorNames || {})]).name : `牌友${this.authority.game.players.indexOf(member)+1}`}; }
        }
        if(action==='close-room') state.closed=true;
        state.updatedAt=Date.now();
        await securityCall(this.env,'moderate',{room,state,event});
        applyModeration(this.authority,state);
        if(action==='restrict-member') for(const ws of this.sockets()) if(attachment(ws).playerId===input.memberId){send(ws,{type:'fatal',message:'该成员已被站长限制。'});this.remove(ws,1008);}
        await this.persistAndPublish(room);
        return json({ok:true});
      }catch{console.error('STATIONMASTER_OPERATION_FAILED');return json({error:'Operation failed; retry after checking storage'},503);}
    });
  }
  webSocketMessage(ws, raw) {
    return this.serial(async () => {
      const message = parse(raw);
      if (!message || typeof message !== 'object') return this.deny(ws,'security.invalid-frame',1009);
      const info = attachment(ws);
      if (info.removed) return;
      if (!info.authenticated) return this.authorize(ws, message);
      const now = Date.now();
      const count = now - (info.windowStart || 0) < 1000 ? (info.count || 0) + 1 : 1;
      ws.serializeAttachment({ ...info, count, lastSeen: now, windowStart: count === 1 ? now : info.windowStart });
      if (count > 40) return this.deny(ws,'security.rate-limited');
      this.advance(now);
      if (!this.authority.closed) {
        const data = message.type === 'send' ? message.data : message.type === 'close-room' ? { type: 'dissolve' } : null;
        const requestId = data?.type === 'action' && typeof data.requestId === 'string' && /^[A-Za-z0-9._:-]{1,80}$/.test(data.requestId) ? data.requestId : null;
        try {
          if (!data || typeof data !== 'object') throw new Error('无效房间操作。');
          enforceRequest(this.edition, data); // Before old successful receipts or any persistence/broadcast.
          if (data.type === 'leave') {
            this.remove(ws);
            if (!this.sockets().some(other => attachment(other).playerId === info.playerId)) this.authority.disconnect(info.playerId, now);
          } else {
            // Optional request IDs make a retried operation idempotent across
            // reconnects and process restarts. Never replay an old action with
            // different content under the same identity/request pair.
            const id = typeof data.requestId === 'string' && /^[A-Za-z0-9._:-]{1,80}$/.test(data.requestId) ? data.requestId : null;
            const key = id ? `${info.playerId}:${id}` : null;
            const receipt = key && this.authority.record.requests?.find(entry => entry.key === key);
            const payload = JSON.stringify(data);
            if (receipt && receipt.payload !== payload) throw new Error('操作编号已用于另一项操作。');
            if (!receipt) {
              const moderation=await securityCall(this.env,'moderation',{room:info.room});
              applyModeration(this.authority,moderation);
              if((moderation?.restricted || []).includes(info.playerId)) throw Error('该成员已被站长限制。');
              if(data.type==='action' && ['chat','rename'].includes(data.action?.type)) await recordSecurity(this.env,{kind:`publish.${data.action.type}`,room:info.room,actor:info.spectator?'spectator':info.playerId,connection:info.id,outcome:'attempt'});
              this.authority.handle({ id: info.playerId, spectator: info.spectator }, data, now);
              if (key) {
                this.authority.record.requests ||= [];
                this.authority.record.requests.push({ key, payload, at:now });
                this.authority.record.requests = this.authority.record.requests.slice(-256);
              }
            }
            if (data.type === 'remove') for (const other of this.sockets()) if (attachment(other).playerId === data.id) {
              send(other, { type: 'data', data: { type: 'removed' } }); this.remove(other);
            }
          }
        } catch (error) { await recordSecurity(this.env,{kind:'security.action-rejected',room:info.room,actor:info.spectator?'spectator':info.playerId,outcome:'deny'}).catch(()=>{}); send(ws, { type: 'data', data: { type: 'error', message: error.message, ...(requestId ? { requestId } : {}) } }); }
      }
      await this.persistAndPublish(info.room);
    });
  }
  webSocketClose(ws) {
    return this.serial(async () => {
      const info = attachment(ws);
      if (!info.authenticated || info.removed) return;
      await recordSecurity(this.env,{kind:'network.disconnect',room:info.room,actor:info.spectator?'spectator':info.playerId,connection:info.id,outcome:'closed'});
      this.remove(ws);
      if (!this.sockets().some(other => attachment(other).playerId === info.playerId)) this.authority?.disconnect(info.playerId);
      await this.persistAndPublish(info.room);
    });
  }
  webSocketError(ws) { return this.webSocketClose(ws); }
  alarm() {
    return this.serial(async () => {
      if (!this.authority) return;
      const now = Date.now();
      this.advance(now);
      const room = await this.ctx.storage.get('room');
      await this.persistAndPublish(room);
    });
  }
}

export class RoomDirectory {
  constructor(ctx, env = {}) {
    this.edition = serverEdition(env);
    this.ctx = ctx;
    if (typeof WebSocketRequestResponsePair !== 'undefined') ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }
  async fetch(request) {
    if (new URL(request.url).pathname === '/update' && request.method === 'POST') {
      const { room, descriptor } = await request.json();
      if (typeof room !== 'string' || !/^[A-Z2-9]{8}$/.test(room)) return json({}, 400);
      const value = publicRoom(descriptor);
      if (value?.room === room) {
        await this.ctx.storage.put(`room:${room}`, { value, expires: Date.now() + DIRECTORY_TTL });
      } else await this.ctx.storage.delete(`room:${room}`);
      await this.publish(); return json({ ok: true });
    }
    if (this.ctx.getWebSockets().length >= 1000) return json({}, 429);
    return accept(this.ctx, {});
  }
  async publish() {
    const sockets = this.ctx.getWebSockets().filter(ws => attachment(ws).authenticated && !attachment(ws).removed);
    const entries = await this.ctx.storage.list({ prefix: 'room:' });
    const rooms = [];
    for (const [key, entry] of entries) {
      if (entry.expires > Date.now()) rooms.push(entry.value);
      else await this.ctx.storage.delete(key);
    }
    const count = new Set(sockets.map(ws => attachment(ws).visitor)).size;
    const message = { type: 'directory', count, rooms: publicRooms(rooms).filter(room => this.edition !== 'cn' || CN_NICKNAMES.includes(room.hostName)) };
    for (const ws of sockets) send(ws, message);
    if (rooms.length) await this.ctx.storage.setAlarm(Date.now() + 30000);
  }
  async webSocketMessage(ws, raw) {
    const message = parse(raw);
    if (!message || message.type !== 'hello' || !uuid(message.visitor) || attachment(ws).authenticated) return close(ws, 1008);
    ws.serializeAttachment({ ...attachment(ws), visitor: message.visitor, authenticated: true });
    send(ws, { type: 'ready' }); await this.publish();
  }
  async webSocketClose(ws) {
    ws.serializeAttachment({ ...attachment(ws), removed: true }); close(ws);
    await this.publish();
  }
  webSocketError(ws) { return this.webSocketClose(ws); }
  alarm() { return this.publish(); }
}
