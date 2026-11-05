import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync, statfsSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { SECURITY_SCHEMA, cleanEvent, numericSetting, validHold, ConnectionGuard, RELEASE_HOLD_REASONS } from '../worker/security.js';
export class SecurityStore {
  constructor(path,env={}) {
    this.path=path; this.env=env;this.connections=new ConnectionGuard();
    if(path!==':memory:') mkdirSync(dirname(path),{recursive:true,mode:0o750});
    this.db=new DatabaseSync(path); if(path!==':memory:') chmodSync(path,0o600);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;'); this.db.exec(SECURITY_SCHEMA);
  }
  checkCapacity() {
    if(this.path===':memory:') return;
    const fs=statfsSync(dirname(this.path)), free=Number(fs.bavail)*Number(fs.bsize);
    const min=numericSetting(this.env.SECURITY_MIN_FREE_BYTES,256*1024*1024);
    const pages=Number(this.db.prepare('PRAGMA page_count').get().page_count), reusable=Number(this.db.prepare('PRAGMA freelist_count').get().freelist_count), pageSize=Number(this.db.prepare('PRAGMA page_size').get().page_size);
    const used=(pages-reusable)*pageSize;
    const cap=numericSetting(this.env.SECURITY_MAX_BYTES,256*1024*1024);
    if(free<min || used>=cap) { console.error('SECURITY_DISK_CAPACITY_EXHAUSTED'); throw Error('Security storage capacity unavailable'); }
    if((free<min*2 || used>=cap*0.8) && Date.now()-(this.lastWarning || 0)>60000) {this.lastWarning=Date.now();console.warn('SECURITY_DISK_CAPACITY_WARNING');}
  }
  append(input) { this.checkCapacity();const admitted=input.kind!=='network.connect' || this.connections.allow(input.ip);const event=cleanEvent(admitted?input:{...input,kind:'security.connection-limited',outcome:'deny'});this.db.prepare('INSERT INTO security_events(at,expires_at,event) VALUES(?,?,?)').run(event.at,event.expires_at,event.event);if(!admitted){const error=Error('Connection rate limited');error.status=429;throw error;}return{ok:true}; }
  moderation(room) { const row=this.db.prepare('SELECT state FROM security_moderation WHERE room=?').get(room);return row?JSON.parse(row.state):{}; }
  moderate(input) {
    this.checkCapacity(); const event=cleanEvent(input.event); this.db.exec('BEGIN IMMEDIATE');
    try { this.db.prepare('INSERT INTO security_events(at,expires_at,event) VALUES(?,?,?)').run(event.at,event.expires_at,event.event);this.db.prepare('INSERT INTO security_moderation(room,state,expires_at) VALUES(?,?,?) ON CONFLICT(room) DO UPDATE SET state=excluded.state,expires_at=excluded.expires_at').run(input.room,JSON.stringify(input.state),Date.now()+200*86400000);this.db.exec('COMMIT');return{ok:true}; }
    catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  purge(now=Date.now()) { const result=this.db.prepare('DELETE FROM security_events WHERE id IN (SELECT id FROM security_events WHERE held=0 AND expires_at<=? ORDER BY id LIMIT 500)').run(now); this.db.prepare("DELETE FROM security_moderation WHERE room IN (SELECT room FROM security_moderation WHERE held=0 AND expires_at<=? AND NOT EXISTS (SELECT 1 FROM security_events WHERE held=1 AND json_extract(event,'$.room')=security_moderation.room) LIMIT 100)").run(now); this.db.exec('PRAGMA wal_checkpoint(PASSIVE)'); return Number(result.changes); }
  async fetch(url,init) {
    try { const action=new URL(url).pathname.slice(1), input=JSON.parse(init.body); let value;
      if(action==='append')value=this.append(input);
      else if(action==='moderation')value=this.moderation(input.room);
      else if(action==='moderate')value=this.moderate(input);
      else if(action==='list')value={events:this.db.prepare('SELECT * FROM security_events WHERE id>? ORDER BY id LIMIT 100').all(Number(input.after)||0).map(row=>({...row,event:JSON.parse(row.event)}))};
      else if(action==='hold'){
        if(!validHold(input))return Response.json({error:'ID, held and reason required'},{status:400});
        const target=this.db.prepare('SELECT event FROM security_events WHERE id=?').get(input.id);
        if(!target)return Response.json({error:'Event not found'},{status:404});
        if(JSON.parse(target.event).kind==='admin.hold-change')return Response.json({error:'Hold reason follows its source record; use the referenced event ID'},{status:400});
        this.checkCapacity();const event=cleanEvent({kind:'admin.hold-change',seq:input.id,action:input.held?'hold':'release',reason:input.reason});
        this.db.exec('BEGIN IMMEDIATE');
        try{
          if(!input.held)this.db.prepare(RELEASE_HOLD_REASONS).run(input.id);
          this.db.prepare('INSERT INTO security_events(at,expires_at,event,held) VALUES(?,?,?,?)').run(event.at,event.expires_at,event.event,input.held?1:0);
          this.db.prepare('UPDATE security_events SET held=? WHERE id=?').run(input.held?1:0,input.id);
          this.db.exec('COMMIT');
        }catch(error){this.db.exec('ROLLBACK');throw error;}value={ok:true};
      }
      else if(action==='health'){this.checkCapacity();if(this.db.prepare('UPDATE security_usage SET bytes=bytes WHERE id=1').run().changes!==1)throw Error('Security usage row missing');value={ok:true};}
      else return Response.json({error:'Unknown operation'},{status:400});
      return Response.json(value);
    }catch(error){if(error.status===429)return Response.json({error:'Connection rate limited'},{status:429});console.error('SECURITY_STORAGE_FAILURE');return Response.json({error:'Security storage unavailable'},{status:503});}
  }
  close(){this.db.close();}
}
