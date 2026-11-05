export const SECURITY_SCHEMA = `CREATE TABLE IF NOT EXISTS security_events (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, expires_at INTEGER NOT NULL, event TEXT NOT NULL, held INTEGER NOT NULL DEFAULT 0); CREATE INDEX IF NOT EXISTS security_expiry ON security_events(held,expires_at); CREATE TABLE IF NOT EXISTS security_moderation (room TEXT PRIMARY KEY, state TEXT NOT NULL, expires_at INTEGER NOT NULL, held INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS security_usage (id INTEGER PRIMARY KEY CHECK(id=1), bytes INTEGER NOT NULL);
INSERT OR IGNORE INTO security_usage(id,bytes) VALUES(1,0);
CREATE TRIGGER IF NOT EXISTS security_event_insert AFTER INSERT ON security_events BEGIN UPDATE security_usage SET bytes=bytes+length(CAST(NEW.event AS BLOB))+256 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS security_event_delete AFTER DELETE ON security_events BEGIN UPDATE security_usage SET bytes=bytes-length(CAST(OLD.event AS BLOB))-256 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS security_moderation_insert AFTER INSERT ON security_moderation BEGIN UPDATE security_usage SET bytes=bytes+length(CAST(NEW.state AS BLOB))+256 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS security_moderation_update AFTER UPDATE OF state ON security_moderation BEGIN UPDATE security_usage SET bytes=bytes+length(CAST(NEW.state AS BLOB))-length(CAST(OLD.state AS BLOB)) WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS security_moderation_delete AFTER DELETE ON security_moderation BEGIN UPDATE security_usage SET bytes=bytes-length(CAST(OLD.state AS BLOB))-256 WHERE id=1; END;`;
export class ConnectionGuard {
  constructor(){this.entries=new Map();}
  allow(ip,now=Date.now()) {
    for(const [key,entry] of this.entries) if(entry.until<=now)this.entries.delete(key);
    const key=ip || 'unknown',entry=this.entries.get(key);
    if(entry){if(entry.count>=120)return false;entry.count++;return true;}
    if(this.entries.size>=4096)return false;
    this.entries.set(key,{count:1,until:now+60000});return true;
  }
}
export const DEFAULT_CONTACT = 'qiutian0808@163.com';
export function retentionEnd(at, kind) {
  const date = new Date(at);
  if (kind.startsWith('admin.')) return at + 90 * 86400000;
  // 200 days is deliberately no shorter than any six calendar months.
  date.setUTCDate(date.getUTCDate() + 200); return date.getTime();
}
export function cleanEvent(input, now = Date.now()) {
  const event = {};
  for (const [field, max] of Object.entries({kind:64, room:8, actor:80, connection:80, ip:64, route:80, outcome:32, action:32, reason:300, content:300, memberId:80})) {
    if (typeof input[field] === 'string') event[field] = input[field].replace(/[\p{Cc}\p{Cf}]/gu, '').slice(0,max);
  }
  if(event.kind?.startsWith('admin.')) event.actor='stationmaster';
  if (!/^(network|security|publish|admin)\.[a-z-]+$/.test(event.kind || '')) throw Error('Invalid security event');
  if (Number.isSafeInteger(input.seq) && input.seq > 0) event.seq = input.seq;
  return { at: now, expires_at: retentionEnd(now,event.kind), event: JSON.stringify(event) };
}
export function numericSetting(value, fallback, min = 1) {
  if (value === undefined || value === '') return fallback;
  const number = Number(value); if (!Number.isSafeInteger(number) || number < min) throw Error('Invalid security capacity setting'); return number;
}
export const validHold = input => Number.isSafeInteger(input.id) && input.id>0 && typeof input.held==='boolean' && typeof input.reason==='string' && !!input.reason.trim() && input.reason.length<=300;
// Hold-reason rows follow their source record. Keep the reason for the full hold
// without changing immutable archive expiries. After release normal expiry
// applies; the separate release audit receives its own 90-day term.
export const RELEASE_HOLD_REASONS = "UPDATE security_events SET held=0 WHERE json_extract(event,'$.kind')='admin.hold-change' AND json_extract(event,'$.action')='hold' AND json_extract(event,'$.seq')=?";
export async function adminAuthorized(request, env) {
  const secret = env.SECURITY_ADMIN_TOKEN;
  if (typeof secret !== 'string' || secret.length < 32) return false;
  const provided = request.headers.get('Authorization') || '';
  if (!provided.startsWith('Bearer ') || provided.length > 512) return false;
  const digest = async text => new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)));
  const [a,b] = await Promise.all([digest(secret),digest(provided.slice(7))]);
  let difference = 0; for(let i=0;i<a.length;i++) difference |= a[i]^b[i]; return difference === 0;
}
export async function securityCall(env, path, value) {
  if (!env.SECURITY) { if(env.SECURITY_TEST_NO_AUDIT===true) return null; console.error('SECURITY_BINDING_MISSING'); throw Error('必要安全记录暂不可用，请稍后重试。'); }
  const response = await env.SECURITY.getByName('security-v1').fetch(`https://security/${path}`, {method:'POST', body:JSON.stringify(value || {})});
  if (!response.ok) { console.error('SECURITY_WRITE_UNAVAILABLE', response.status); const error=Error('必要安全记录暂不可用，请稍后重试。');error.status=response.status===429?429:503;throw error; }
  return response.json();
}
export async function recordSecurity(env, event) { return securityCall(env,'append',event); }
export function applyModeration(authority, state) {
  if (!authority || !state) return;
  authority.record.moderation = state;
  const game = authority.game;
  const hiddenText=new Set((game.chat || []).filter(message=>(state.hiddenChat || []).includes(message.seq)).map(message=>message.text));
  authority.record.requests=(authority.record.requests || []).filter(entry=>{try{const action=JSON.parse(entry.payload).action;return !(action?.type==='chat' && hiddenText.has(action.text?.trim())) && !(action?.type==='rename' && Object.keys(state.names || {}).length);}catch{return false;}});
  game.chat = (game.chat || []).filter(message => !(state.hiddenChat || []).includes(message.seq));
  game.publicEvents = (game.publicEvents || []).filter(event => !(state.hiddenEvents || []).includes(event.seq) && (!event.source?.chatSeq || !(state.hiddenChat || []).includes(event.source.chatSeq)));
  for (const [id, name] of Object.entries(state.names || {})) {
    const player=game.players.find(member=>member.id===id),known=new Set([player?.name,...game.chat.filter(message=>message.player===id).map(message=>message.name)].filter(Boolean));
    // Old rooms have text-only rename events; follow the bounded legacy chain.
    const events=game.publicEvents || [];
    for(const event of events) if(event.source?.actor===id) for(const value of [event.source.previousName,event.source.name]) if(value)known.add(value);
    for(let pass=0;pass<events.length;pass++) {let changed=false;for(const event of events) {const parts=event.text.split(' 改名为 ');if(parts.length===2 && parts.some(part=>known.has(part)))for(const part of parts)if(!known.has(part)){known.add(part);changed=true;}}if(!changed)break;}
    const redact=text=>[...known].filter(value=>value!==name).sort((a,b)=>b.length-a.length).reduce((value,hidden)=>value.split(hidden).join(name),text);
    if(player)player.name=name;
    for(const message of game.chat) {if(message.player===id)message.name=name;message.text=redact(message.text);}
    game.publicEvents=events.filter(event=>event.source || !event.text.includes(' 改名为 ')).map(event=>({...event,text:redact(event.text)}));
    game.log=(game.log || []).map(redact);
  }
  // Legacy journal lines cannot reliably identify a historical nickname's actor.
  // Once per name disposition, discard those old lines rather than leave a copy.
  if(state.nameRedactionAt && (authority.record.nameRedactionAt || 0)<state.nameRedactionAt){game.log=[];game.publicEvents=(game.publicEvents || []).filter(event=>event.source || event.time>state.nameRedactionAt);authority.record.nameRedactionAt=state.nameRedactionAt;}
  for(const id of state.restricted || []) authority.disconnect(id);
  if (state.closed && !authority.closed) authority.close('站长已关闭房间。');
}
export class SecurityLedger {
  constructor(ctx,env) {
    this.ctx=ctx; this.env=env; this.sql=ctx.storage.sql; this.sql.exec(SECURITY_SCHEMA);this.connections=new ConnectionGuard();
  }
  rows(query,...args) { return [...this.sql.exec(query,...args)]; }
  async fetch(request) {
    try {
      const action=new URL(request.url).pathname.slice(1), input=await request.json();
      if(action==='health') { this.checkCapacity();this.sql.exec('UPDATE security_usage SET bytes=bytes WHERE id=1');return Response.json({ok:true}); }
      if(action==='moderation') return Response.json(this.rows('SELECT state FROM security_moderation WHERE room=?',input.room).map(row=>JSON.parse(row.state))[0] || {});
      if(action==='list') return Response.json({events:this.rows('SELECT * FROM security_events WHERE id>? ORDER BY id LIMIT 100',Number(input.after)||0).map(row=>({...row,event:JSON.parse(row.event)}))});
      if(action==='hold') {
        if(!validHold(input)) return Response.json({error:'ID, held and reason required'},{status:400});
        const target=this.rows('SELECT event FROM security_events WHERE id=?',input.id)[0];
        if(!target)return Response.json({error:'Event not found'},{status:404});
        if(JSON.parse(target.event).kind==='admin.hold-change')return Response.json({error:'Hold reason follows its source record; use the referenced event ID'},{status:400});
        const event=cleanEvent({kind:'admin.hold-change',seq:input.id,action:input.held?'hold':'release',reason:input.reason});
        this.checkCapacity();
        this.ctx.storage.transactionSync(()=>{
          if(!input.held)this.sql.exec(RELEASE_HOLD_REASONS,input.id);
          this.sql.exec('INSERT INTO security_events(at,expires_at,event,held) VALUES(?,?,?,?)',event.at,event.expires_at,event.event,input.held?1:0);
          this.sql.exec('UPDATE security_events SET held=? WHERE id=?',input.held?1:0,input.id);
        });
        await this.scheduleCleanup();return Response.json({ok:true});
      }
      if(action==='moderate') {
        const event=cleanEvent(input.event); this.checkCapacity();
        this.ctx.storage.transactionSync(()=>{ this.sql.exec('INSERT INTO security_events(at,expires_at,event) VALUES(?,?,?)',event.at,event.expires_at,event.event); this.sql.exec('INSERT INTO security_moderation(room,state,expires_at) VALUES(?,?,?) ON CONFLICT(room) DO UPDATE SET state=excluded.state,expires_at=excluded.expires_at',input.room,JSON.stringify(input.state),Date.now()+200*86400000); });
      } else if(action==='append') {
        const admitted=input.kind!=='network.connect' || this.connections.allow(input.ip);
        const event=cleanEvent(admitted?input:{...input,kind:'security.connection-limited',outcome:'deny'}); this.checkCapacity(); this.sql.exec('INSERT INTO security_events(at,expires_at,event) VALUES(?,?,?)',event.at,event.expires_at,event.event);if(!admitted)return Response.json({error:'Connection rate limited'},{status:429});
      } else return Response.json({error:'Unknown operation'},{status:400});
      await this.scheduleCleanup(); return Response.json({ok:true});
    } catch { console.error('SECURITY_STORAGE_FAILURE'); return Response.json({error:'Security storage unavailable'},{status:503}); }
  }
  checkCapacity() {
    const cap=numericSetting(this.env.SECURITY_MAX_BYTES,256*1024*1024);
    // Trigger-maintained conservative live bytes avoid a table scan per event.
    // Expired pages remain physically allocated and are reusable.
    const used=Number(this.rows('SELECT bytes FROM security_usage WHERE id=1')[0].bytes);
    if(used>=cap) throw Error('Security capacity exhausted');
    if(used>=cap*0.8 && Date.now()-(this.lastWarning || 0)>60000){this.lastWarning=Date.now();console.warn('SECURITY_CAPACITY_WARNING');}
  }
  async scheduleCleanup() {const next=Date.now()+3600000;const alarm=await this.ctx.storage.getAlarm();if(!alarm || alarm>next)await this.ctx.storage.setAlarm(next);}
  async alarm() {
    const ids=this.rows('SELECT id FROM security_events WHERE held=0 AND expires_at<=? ORDER BY id LIMIT 500',Date.now());
    for(const {id} of ids) this.sql.exec('DELETE FROM security_events WHERE id=?',id);
    for(const {room} of this.rows("SELECT room FROM security_moderation WHERE held=0 AND expires_at<=? AND NOT EXISTS (SELECT 1 FROM security_events WHERE held=1 AND json_extract(event,'$.room')=security_moderation.room) LIMIT 100",Date.now())) this.sql.exec('DELETE FROM security_moderation WHERE room=?',room);
    // SQLite reuses freed pages; do not VACUUM in the request path.
    await this.ctx.storage.setAlarm(Date.now()+(ids.length===500?60000:3600000));
  }
}
