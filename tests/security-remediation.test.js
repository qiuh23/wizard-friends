import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { SecurityStore } from '../server/security-store.js';
import { retentionEnd, cleanEvent, ConnectionGuard } from '../worker/security.js';
import { createServer } from '../server/index.js';
import { ChatNotices } from '../src/chat-notices.js';
const secret='local-test-stationmaster-secret-123456789';
const room='ABCDEFGH';
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(callback){for(let n=0;n<300;n++){const value=callback();if(value)return value;await wait(10);}throw Error('Condition timeout');}
async function connect(base,{token=crypto.randomUUID(),host=false,name=host?'房主':'访客'}={}){
  const socket=new WebSocket(`${base.replace('http:','ws:')}/api/rooms/${room}/ws`),messages=[];
  const client={socket,messages,token,closed:false,get state(){return messages.findLast(value=>value.data?.type==='state')?.data.state;},get id(){return messages.findLast(value=>value.data?.type==='state')?.data.me;},async action(action){const count=messages.length;socket.send(JSON.stringify({type:'send',data:{type:'action',action,requestId:crypto.randomUUID()}}));await until(()=>messages.length>count);}};
  socket.on('message',value=>{if(value.toString()!=='pong')messages.push(JSON.parse(value.toString()));});socket.on('close',()=>client.closed=true);socket.on('error',()=>{});
  await new Promise((resolve,reject)=>{socket.once('open',resolve);socket.once('error',reject);});socket.send(JSON.stringify({type:'hello',version:2,host,name,token}));await until(()=>client.state || messages.some(value=>value.type==='fatal') || client.closed);return client;
}
async function admin(base,input,token=secret){return fetch(`${base}/api/stationmaster/rooms/${room}`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(input)});}
async function nodeFixture(t,env={}){
  const dir=await mkdtemp(join(tmpdir(),'wizard-security-'));await writeFile(join(dir,'index.html'),'<html>local</html>');
  const config={host:'127.0.0.1',port:0,staticDir:dir,databasePath:join(dir,'rooms.sqlite'),publicOrigin:'http://local.example',env:{SECURITY_ADMIN_TOKEN:secret,...env}};
  let app=await createServer(config),address=await app.listen();
  t.after(async()=>{await app.close();await rm(dir,{recursive:true,force:true});});
  return{dir,config,get app(){return app;},get base(){return `http://127.0.0.1:${address.port}`;},async restart(){await app.close();app=await createServer(config);address=await app.listen();}};
}
test('audit whitelist, 200 day network floor, independent evidence90d, bounded expiry, hold and reopen',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'wizard-ledger-')),path=join(dir,'security.sqlite');t.after(()=>rm(dir,{recursive:true,force:true}));
  let store=new SecurityStore(path);const at=Date.UTC(2026,0,31);
  assert.equal(retentionEnd(at,'network.connect')-at,200*86400000);assert.equal(retentionEnd(at,'admin.moderation')-at,90*86400000);
  const entry=cleanEvent({kind:'network.connect',token:'must-not-store',cookie:'secret',hand:['private'],room});assert.equal(entry.event.includes('secret'),false);assert.equal(entry.event.includes('private'),false);
  for(let i=0;i<505;i++)store.append({kind:'network.connect',room,ip:`192.0.2.${i%255}`});
  store.db.prepare('UPDATE security_events SET expires_at=1').run();store.db.prepare('UPDATE security_events SET held=1 WHERE id=1').run();
  assert.equal(store.purge(),500);assert.equal(store.db.prepare('SELECT count(*) AS n FROM security_events').get().n,5);assert.equal(store.purge(),4);
  store.close();store=new SecurityStore(path);assert.equal(store.db.prepare('SELECT held FROM security_events').get().held,1);store.close();
});
test('capacity rejects writes, preserves unexpired rows, and expired-page reuse recovers without VACUUM',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'wizard-capacity-'));const env={SECURITY_MAX_BYTES:String(96*1024),SECURITY_MIN_FREE_BYTES:'1'},store=new SecurityStore(join(dir,'security.sqlite'),env);t.after(async()=>{store.close();await rm(dir,{recursive:true,force:true});});
  let accepted=0;for(let i=0;i<1000;i++){try{store.append({kind:'network.connect',room,route:'room-ws',connection:'x'.repeat(80),ip:`192.0.2.${i%255}`});accepted++;}catch{break;}}
  assert.ok(accepted>0 && accepted<1000);assert.equal(store.db.prepare('SELECT count(*) AS n FROM security_events').get().n,accepted);
  store.db.prepare('UPDATE security_events SET expires_at=1').run();while(store.purge()===500){}store.append({kind:'network.connect',room});assert.equal(store.db.prepare('SELECT count(*) AS n FROM security_events').get().n,1);
});
test('stationmaster authority, live hide/name update, reconnect restrictions, close and independent audit survive restart',async t=>{
  const f=await nodeFixture(t),host=await connect(f.base,{host:true}),guest=await connect(f.base,{name:'小满'});
  await host.action({type:'chat',text:'需要隐藏的内容'});await until(()=>guest.state?.chat?.length===1);const seq=host.state.chat[0].seq;
  assert.equal((await admin(f.base,{action:'inspect'},host.token)).status,403);
  assert.equal((await admin(f.base,{action:'hide-chat',seq,reason:'人工核实举报'})).status,200);await until(()=>guest.state.chat.length===0);assert.equal(JSON.stringify(guest.state).includes('需要隐藏的内容'),false);
  await host.action({type:'rename',name:'待处置昵称'});assert.equal((await admin(f.base,{action:'hide-name',memberId:host.id,reason:'昵称不当'})).status,200);await until(()=>host.state.players[0].name==='牌友1');assert.equal(JSON.stringify(host.state).includes('待处置昵称'),false);
  assert.equal((await admin(f.base,{action:'restrict-member',memberId:guest.id,reason:'持续滥用'})).status,200);await until(()=>guest.closed);const blocked=await connect(f.base,{token:guest.token,name:'小满'});assert.equal(blocked.state,undefined);blocked.socket.close();
  await f.restart();const resumed=await connect(f.base,{host:true,token:host.token});assert.equal(resumed.state.chat.length,0);assert.equal(JSON.stringify(resumed.state).includes('需要隐藏的内容'),false);assert.equal(resumed.state.players[0].name,'牌友1');
  const audit=f.app.securityStore.db.prepare('SELECT event FROM security_events').all().map(row=>JSON.parse(row.event));assert.ok(audit.some(event=>event.kind==='admin.moderation' && event.content==='需要隐藏的内容'));assert.equal(audit.some(event=>JSON.stringify(event).includes(host.token)),false);
  assert.equal((await admin(f.base,{action:'close-room',reason:'停止房间扩散'})).status,200);await f.restart();const closed=await connect(f.base,{host:true,token:host.token});assert.equal(closed.state,undefined);closed.socket.close();assert.ok(f.app.securityStore.db.prepare('SELECT count(*) AS n FROM security_events').get().n>0);
});
test('historical nickname chains and legacy public journals cannot reappear after name disposition',async t=>{
  const f=await nodeFixture(t),host=await connect(f.base,{host:true});await host.action({type:'rename',name:'旧不当昵称'});await host.action({type:'rename',name:'新不当昵称'});
  const context=f.app.contexts.get(room);await context.execute(async()=>{context.controller.authority.game.publicEvents.push({seq:999,time:Date.now()-1000,text:'旧不当昵称 改名为 新不当昵称'});context.controller.authority.game.log.push('旧不当昵称 曾出牌');await context.controller.persistAndPublish(room);});
  const inspected=await (await admin(f.base,{action:'inspect'})).json();assert.ok(inspected.publicEvents.some(event=>event.text.includes('旧不当昵称')));assert.equal(JSON.stringify(inspected).includes('identities'),false);
  assert.equal((await admin(f.base,{action:'hide-name',memberId:host.id,reason:'处理此前反复改名'})).status,200);await until(()=>host.state.players[0].name==='牌友1');assert.equal(JSON.stringify(host.state).includes('旧不当昵称'),false);assert.equal(JSON.stringify(host.state).includes('新不当昵称'),false);
  await f.restart();const resumed=await connect(f.base,{host:true,token:host.token});assert.equal(JSON.stringify(resumed.state).includes('旧不当昵称'),false);
});
test('disk reserve failure denies dependent new connections without deleting retained records',async t=>{
  const f=await nodeFixture(t);f.app.securityStore.append({kind:'network.connect',room});f.config.env.SECURITY_MIN_FREE_BYTES=String(Number.MAX_SAFE_INTEGER);
  const response=await fetch(`${f.base}/api/security/health`);assert.equal(response.status,503);
  const socket=new WebSocket(`${f.base.replace('http:','ws:')}/api/rooms/${room}/ws`);const error=await new Promise(resolve=>socket.once('error',resolve));assert.match(error.message,/503/);assert.equal(f.app.store.all().length,0);assert.equal(f.app.securityStore.db.prepare('SELECT count(*) AS n FROM security_events').get().n,1);
});
test('required record failure blocks chat, rename and administrator publication on existing connections',async t=>{
  const f=await nodeFixture(t),host=await connect(f.base,{host:true}),before=f.app.securityStore.db.prepare('SELECT count(*) AS n FROM security_events').get().n;
  f.config.env.SECURITY_MIN_FREE_BYTES=String(Number.MAX_SAFE_INTEGER);await host.action({type:'chat',text:'must not publish'});await host.action({type:'rename',name:'must not rename'});
  const authority=f.app.contexts.get(room).controller.authority;assert.equal(authority.game.chat.length,0);assert.equal(authority.game.players[0].name,'房主');
  assert.equal((await admin(f.base,{action:'close-room',reason:'write failure test'})).status,503);assert.equal(authority.closed,false);assert.deepEqual(f.app.securityStore.moderation(room),{});assert.equal(f.app.securityStore.db.prepare('SELECT count(*) AS n FROM security_events').get().n,before);
});

test('read-only audit storage fails write readiness and blocks dependent publications without changing counters',async t=>{
  const f=await nodeFixture(t),host=await connect(f.base,{host:true});
  const before=f.app.securityStore.db.prepare('SELECT bytes FROM security_usage WHERE id=1').get().bytes;
  assert.equal((await fetch(`${f.base}/api/security/health`)).status,200);
  assert.equal(f.app.securityStore.db.prepare('SELECT bytes FROM security_usage WHERE id=1').get().bytes,before);
  const events=f.app.securityStore.db.prepare('SELECT count(*) AS n FROM security_events').get().n;
  f.app.securityStore.db.exec('PRAGMA query_only=ON');
  assert.equal((await fetch(`${f.base}/api/security/health`)).status,503);
  await host.action({type:'chat',text:'must not publish from read-only storage'});
  await host.action({type:'rename',name:'must not rename'});
  const authority=f.app.contexts.get(room).controller.authority;
  assert.equal(authority.game.chat.length,0);assert.equal(authority.game.players[0].name,'房主');
  assert.equal(f.app.securityStore.db.prepare('SELECT count(*) AS n FROM security_events').get().n,events);
  assert.equal(f.app.securityStore.db.prepare('SELECT bytes FROM security_usage WHERE id=1').get().bytes,before);
});
test('connection guard has bounded source windows and invalid-room handshakes do not persist empty rooms',async t=>{
  const guard=new ConnectionGuard();for(let i=0;i<120;i++)assert.equal(guard.allow('192.0.2.1',0),true);assert.equal(guard.allow('192.0.2.1',1),false);assert.equal(guard.allow('192.0.2.1',60000),true);
  const f=await nodeFixture(t);for(let i=0;i<4;i++){const code=`AAAAAAA${'BCDE'[i]}`,socket=new WebSocket(`${f.base.replace('http:','ws:')}/api/rooms/${code}/ws`);await new Promise((resolve,reject)=>{socket.once('open',resolve);socket.once('error',reject);});const closed=new Promise(resolve=>socket.once('close',resolve));socket.send(JSON.stringify({type:'hello',host:true,token:i%2?'invalid':crypto.randomUUID(),name:''}));await closed;}
  assert.equal(f.app.store.all().length,0);assert.ok(f.app.contexts.size<=2);
  const events=f.app.securityStore.db.prepare('SELECT event FROM security_events').all().map(row=>JSON.parse(row.event));assert.ok(events.filter(event=>event.kind==='security.auth-rejected').length>=2);
});
test('seven-day chat expiry clears journals/receipts while network records retain their own term',async t=>{
  const f=await nodeFixture(t),host=await connect(f.base,{host:true});await host.action({type:'chat',text:'expired ordinary text'});
  const context=f.app.contexts.get(room),now=Date.now();
  await context.execute(async()=>{for(const message of context.controller.authority.game.chat)message.time=now-8*86400000;for(const event of context.controller.authority.game.publicEvents)event.time=now-8*86400000;for(const receipt of context.controller.authority.record.requests)receipt.at=now-8*86400000;await context.controller.persistAndPublish(room);});
  await until(()=>host.state.chat.length===0);assert.equal(JSON.stringify(context.record).includes('expired ordinary text'),false);assert.ok(f.app.securityStore.db.prepare('SELECT count(*) AS n FROM security_events WHERE expires_at>?').get(now+190*86400000).n>0);
});
test('ordinary players cannot hold records; valid holds record target/time/reason atomically',async t=>{
  const f=await nodeFixture(t);f.app.securityStore.append({kind:'network.connect',room});
  const request=async(token,input)=>fetch(`${f.base}/api/stationmaster/security`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(input)});
  assert.equal((await request(crypto.randomUUID(),{action:'hold',id:1,held:true,reason:'unsupported role'})).status,403);
  assert.equal((await request(secret,{action:'hold',id:1,held:true,reason:'request from authority'})).status,200);
  assert.equal(f.app.securityStore.db.prepare('SELECT held FROM security_events WHERE id=1').get().held,1);
  const event=JSON.parse(f.app.securityStore.db.prepare("SELECT event FROM security_events WHERE json_extract(event,'$.kind')='admin.hold-change'").get().event);assert.equal(event.seq,1);assert.equal(event.reason,'request from authority');assert.equal(event.actor,'stationmaster');
  const reasonId=f.app.securityStore.db.prepare("SELECT id FROM security_events WHERE json_extract(event,'$.kind')='admin.hold-change'").get().id;
  assert.equal(f.app.securityStore.db.prepare('SELECT held FROM security_events WHERE id=?').get(reasonId).held,1);
  assert.equal((await f.app.securityStore.fetch('https://security/hold',{body:JSON.stringify({id:reasonId,held:false,reason:'cannot detach linked reason'})})).status,400);
  f.app.securityStore.db.exec('UPDATE security_events SET expires_at=1');f.app.securityStore.purge();
  assert.equal(f.app.securityStore.db.prepare('SELECT count(*) AS n FROM security_events').get().n,2);
  await f.restart();assert.equal(f.app.securityStore.db.prepare('SELECT held FROM security_events WHERE id=?').get(reasonId).held,1);
  const releasedAt=Date.now();assert.equal((await request(secret,{action:'hold',id:1,held:false,reason:'authority released preservation'})).status,200);
  const reason=f.app.securityStore.db.prepare('SELECT held,expires_at FROM security_events WHERE id=?').get(reasonId);assert.equal(reason.held,0);assert.equal(reason.expires_at,1);
  f.app.securityStore.purge();assert.equal(f.app.securityStore.db.prepare('SELECT id FROM security_events WHERE id=1').get(),undefined);
  assert.equal(f.app.securityStore.db.prepare('SELECT event FROM security_events WHERE id=?').get(reasonId),undefined);
  const release=f.app.securityStore.db.prepare("SELECT event,expires_at FROM security_events WHERE json_extract(event,'$.action')='release'").get();assert.ok(release.event.includes('authority released preservation'));assert.ok(release.expires_at>=releasedAt+90*86400000);
  f.app.securityStore.purge(releasedAt+91*86400000);assert.equal(f.app.securityStore.db.prepare('SELECT count(*) AS n FROM security_events').get().n,0);
});
test('hidden messages are immediately removed from already visible notice bubbles',()=>{const notices=new ChatNotices();notices.update([], 'me',true);notices.update([{seq:1,player:'other',text:'hidden',name:'A'}],'me',true);assert.equal(notices.items.length,1);notices.syncCurrent([{seq:1,player:'other',text:'hidden',name:'改后昵称'}]);notices.update([{seq:1,player:'other',text:'hidden',name:'改后昵称'}],'me',true);assert.equal(notices.items[0].message.name,'改后昵称');notices.syncCurrent([]);notices.update([], 'me',true);assert.equal(notices.items.length,0);});
test('actual Miniflare SQLite ledger, alarm expiry, admin moderation and WebSockets',async t=>{
  const built=await build({stdin:{resolveDir:process.cwd(),contents:`import worker,{RoomRelay,RoomDirectory,SecurityLedger as Ledger} from './worker/index.js'; export {RoomRelay,RoomDirectory}; export class SecurityLedger extends Ledger {async fetch(request){if(new URL(request.url).pathname==='/test-expire'){this.sql.exec('UPDATE security_events SET expires_at=1');await this.alarm();return Response.json({ok:true});}return super.fetch(request);}} export default worker;`},bundle:true,format:'esm',platform:'browser',write:false});
  const mf=new Miniflare(convertV4MiniflareOptions({script:built.outputFiles[0].text,modules:true,compatibilityDate:'2026-10-20',bindings:{SECURITY_ADMIN_TOKEN:secret},durableObjects:{ROOMS:{className:'RoomRelay',useSQLite:true},DIRECTORY:{className:'RoomDirectory',useSQLite:true},SECURITY:{className:'SecurityLedger',useSQLite:true}},serviceBindings:{ASSETS:()=>new Response('local')}}));t.after(()=>mf.dispose());const base=(await mf.ready).origin;
  assert.equal((await fetch(`${base}/api/security/health`)).status,200);const host=await connect(base,{host:true});await host.action({type:'chat',text:'CF hidden'});const seq=host.state.chat[0].seq;assert.equal((await admin(base,{action:'hide-chat',seq,reason:'local CF check'})).status,200);await until(()=>host.state.chat.length===0);assert.equal(JSON.stringify(host.state).includes('CF hidden'),false);
  const namespace=await mf.getDurableObjectNamespace('SECURITY'),ledger=namespace.get(namespace.idFromName('security-v1'));let response=await ledger.fetch('https://security/list',{method:'POST',body:'{}'});const events=(await response.json()).events;assert.ok(events.some(row=>row.event.kind==='admin.moderation'));
  await ledger.fetch('https://security/hold',{method:'POST',body:JSON.stringify({id:events[0].id,held:true,reason:'local preservation test'})});await ledger.fetch('https://security/test-expire',{method:'POST',body:'{}'});response=await ledger.fetch('https://security/list',{method:'POST',body:'{}'});const held=(await response.json()).events;assert.equal(held.length,2);const reason=held.find(row=>row.event.kind==='admin.hold-change');assert.equal(reason.held,1);assert.equal(reason.event.reason,'local preservation test');
  assert.equal((await ledger.fetch('https://security/hold',{method:'POST',body:JSON.stringify({id:reason.id,held:false,reason:'cannot detach reason'})})).status,400);
  const releaseAt=Date.now();assert.equal((await ledger.fetch('https://security/hold',{method:'POST',body:JSON.stringify({id:events[0].id,held:false,reason:'preservation released'})})).status,200);response=await ledger.fetch('https://security/list',{method:'POST',body:'{}'});const released=(await response.json()).events;assert.equal(released.find(row=>row.id===reason.id).held,0);assert.equal(released.find(row=>row.id===reason.id).expires_at,1);assert.ok(released.find(row=>row.event.action==='release').expires_at>=releaseAt+90*86400000);
  await ledger.fetch('https://security/test-expire',{method:'POST',body:'{}'});response=await ledger.fetch('https://security/list',{method:'POST',body:'{}'});assert.equal((await response.json()).events.length,0);host.socket.close();
});
