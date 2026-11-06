import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import worker, { RoomRelay } from '../worker/index.js';
import { RoomAuthority } from '../worker/room-authority.js';
import { createServer } from '../server/index.js';
import { CN_NICKNAMES, assignNickname, nicknameId, nicknameFromId, normalizeEdition, serverEdition, COMMUNICATION_DISABLED } from '../src/site-policy.js';
import { addPlayer, createGame, act } from '../src/game.js';
import { normalizeRuntimeConfig } from '../src/backend-entry.js';
import { applyModeration } from '../worker/security.js';

const cn = () => new RoomAuthority(undefined, Date.now(), 'cn');
const member = authority => authority.join('host-secret', { host:true, nicknameId:nicknameId(0) });

test('trusted edition rejects missing production policy, invalid configuration and cross-edition registries', async () => {
  assert.throws(() => normalizeEdition(undefined), /SITE_EDITION/);
  assert.throws(() => serverEdition({ NODE_ENV:'production' }), /SITE_EDITION/);
  for (const siteEdition of ['cn','global']) {
    const backendId = siteEdition === 'cn' ? 'aliyun' : 'cloudflare';
    const config = {siteEdition,backendId,relayOrigin:'',backends:[{id:backendId,origin:'',enabled:true}]};
    assert.equal(normalizeRuntimeConfig(config,'https://site.test',siteEdition).siteEdition,siteEdition);
    assert.throws(() => normalizeRuntimeConfig(config,'https://site.test',siteEdition === 'cn' ? 'global' : 'cn'), /不匹配/);
    assert.throws(() => normalizeRuntimeConfig({...config,backends:[...config.backends,{id:backendId === 'aliyun' ? 'cloudflare' : 'aliyun',origin:'https://other.test',enabled:true}]},'https://site.test'), /本站/);
  }
  assert.equal((await worker.fetch(new Request('https://site.test/api/health'), {})).status,503);
  const response = await worker.fetch(new Request('https://site.test/runtime-config.json?edition=global'),{SITE_EDITION:'cn',ASSETS:{fetch:()=>Response.json({siteEdition:'cn'})}});
  assert.equal((await response.json()).siteEdition,'cn');
  assert.equal((await worker.fetch(new Request('https://site.test/api/health'),{SITE_EDITION:'cn',ASSETS:{fetch:()=>Response.json({siteEdition:'global'})}})).status,503);
});

test('CN fixed IDs cover the exact astronomy library and do not use deal randomness', () => {
  assert.equal(CN_NICKNAMES.length,32); assert.equal(new Set(CN_NICKNAMES).size,32);
  const a=cn(), random=structuredClone(a.game.randomState); const id=member(a);
  assert.equal(a.game.players[0].name,'天狼星');
  assert.equal(a.game.players[0].nicknameId,nicknameId(0));
  assert.throws(() => a.join('malicious',{name:'自由名字',nicknameId:nicknameId(1)}), /固定昵称/);
  assert.throws(() => a.join('malicious',{nicknameId:'overseas-user'}), /固定昵称/);
  a.handle(id,{type:'addbot'});
  const spectator=a.join('observer',{spectator:true,nicknameId:nicknameId(0)});
  assert.notEqual(a.game.players[1].nicknameId,nicknameId(0));
  assert.equal(new Set([...a.game.players,Object.values(a.game.spectatorNames)[0]].map(p=>p.nicknameId)).size,3);
  assert.match(spectator.id,/^spectator:/); assert.deepEqual(a.game.randomState,random);
  const restored=new RoomAuthority(structuredClone(a.record),Date.now(),'cn');
  const recovered=restored.join('host-secret',{host:true,name:'旧浏览器的名字'});
  assert.equal(recovered.id,id.id); assert.equal(restored.game.players[0].nicknameId,nicknameId(0));
});

test('CN allocation reserves humans, bots, offline seats and spectators, with separate overflow badges', () => {
  const members=[];
  for(let i=0;i<55;i++) members.push(assignNickname({id:String(i),bot:i%2===0,online:i%3===0},members));
  assert.equal(new Set(members.slice(0,32).map(p=>p.name)).size,32);
  assert.equal(new Set(members.map(p=>`${p.nicknameId}:${p.nicknameBadge}`)).size,55);
  assert.ok(members.every(p=>CN_NICKNAMES.includes(p.name)));
});

test('CN migration preserves hands, identities, seats, score, clock and random stream and suppresses legacy public strings', () => {
  const g=createGame();addPlayer(g,'host','旧自由昵称');addPlayer(g,'bot','旧机器人',true);
  g.players[0].hand=[{id:'red-1',kind:'number',suit:'red',rank:1}]; g.players[0].score=42;
  g.log=['旧自由昵称 赢了'];g.chat=[{name:'旧自由昵称',text:'旧聊天'}];g.publicEvents=[{seq:1,time:1,text:'旧自由昵称 发送消息：旧聊天'}];
  const base=new RoomAuthority();base.record.game=g;base.record.hostId='host';base.record.identities.secret='host';
  base.record.lifecycle.paused=true;base.record.lifecycle.pauseReason='旧自由原因';
  base.record.requests=[{key:'host:old',payload:JSON.stringify({type:'action',requestId:'old',action:{type:'chat',text:'旧聊天'}})}];
  const random=structuredClone(g.randomState), a=new RoomAuthority(structuredClone(base.record),Date.now(),'cn');
  assert.equal(a.game.players[0].id,'host');assert.equal(a.game.players[0].score,42);assert.deepEqual(a.game.players[0].hand,g.players[0].hand);
  assert.deepEqual(a.game.randomState,random);assert.deepEqual(a.record.identities,{secret:'host'});assert.equal(a.record.requests.length,0);
  assert.equal(a.life.pauseReason,'房主主动暂停');assert.doesNotMatch(JSON.stringify(a.view({id:'host'},0)),/旧自由|旧聊天|旧机器人/);
  const names=a.game.players.map(p=>p.name);applyModeration(a,{names:{host:'牌友1'}});
  assert.deepEqual(a.game.players.map(p=>p.name),names);
});

test('CN rejects original and new communication/rename protocols but permits trusted pause and normal gameplay', () => {
  const a=cn(), id=member(a);
  for(const action of [{type:'chat',text:'never echo this'},{type:'chat',phraseId:'hello'},{type:'emoji',emojiId:'wave'},{type:'reaction',emojiId:'wave'},{type:'play',phraseId:'hello'}]) {
    assert.throws(()=>a.handle(id,{type:'action',action}),error=>error.message===COMMUNICATION_DISABLED);
    assert.throws(()=>act(a.game,id.id,action),error=>error.message===COMMUNICATION_DISABLED);
  }
  assert.throws(()=>a.handle(id,{type:'action',action:{type:'rename',name:'随便写'}}), /昵称固定/);
  a.handle(id,{type:'pause',reason:'never echo this'});assert.equal(a.life.pauseReason,'房主主动暂停');
  a.handle(id,{type:'resume'});a.handle(id,{type:'addbot'});a.handle(id,{type:'addbot'});
  a.handle(id,{type:'action',action:{type:'start'}});assert.ok(['bid','trump'].includes(a.game.phase));
});

test('CN relay refuses matching legacy successful receipts before replay and never broadcasts submitted body', async () => {
  const store=new Map(), sockets=[];
  const ctx={getWebSockets:()=>sockets,setWebSocketAutoResponse(){},blockConcurrencyWhile:fn=>fn(),storage:{get:async k=>store.get(k),put:async(k,v)=>{for(const [key,value] of typeof k==='object'?Object.entries(k):[[k,v]])store.set(key,structuredClone(value));},setAlarm:async()=>{},deleteAlarm:async()=>{}}};
  const relay=new RoomRelay(ctx,{SITE_EDITION:'cn',SECURITY_TEST_NO_AUDIT:true,DIRECTORY:{getByName:()=>({fetch:async()=>Response.json({})})}});
  await relay.initialized;relay.authority=cn();const id=member(relay.authority);
  const ws={data:{id:'socket',room:'ABCDEFGH',playerId:id.id,host:true,authenticated:true,created:Date.now()},sent:[],deserializeAttachment(){return this.data;},serializeAttachment(v){this.data=v;},send(raw){this.sent.push(JSON.parse(raw));},close(){}};sockets.push(ws);
  const data={type:'action',requestId:'old-success',action:{type:'chat',text:'legacy secret'}};
  relay.authority.record.requests=[{key:`${id.id}:old-success`,payload:JSON.stringify(data),at:Date.now()}];
  await relay.webSocketMessage(ws,JSON.stringify({type:'send',data}));
  assert.equal(ws.sent.find(m=>m.data?.type==='error').data.message,COMMUNICATION_DISABLED);
  assert.doesNotMatch(JSON.stringify(ws.sent),/legacy secret/);assert.equal(relay.authority.game.chat.length,0);
});

test('global retains custom names, free chat, rename and persisted history', () => {
  const a=new RoomAuthority(),id=a.join('global',{host:true,name:'Custom name'});
  a.handle(id,{type:'action',action:{type:'chat',text:'hello world'}});
  a.handle(id,{type:'action',action:{type:'rename',name:'New name'}});
  const restored=new RoomAuthority(structuredClone(a.record));
  assert.equal(restored.game.players[0].name,'New name');assert.equal(restored.view(id).chat[0].text,'hello world');
});

test('real CN Node ingress rejects free names and communication, ignores client edition and recovers stable identity after restart', async t => {
  const directory=await mkdtemp(join(tmpdir(),'wizard-cn-'));
  await writeFile(join(directory,'index.html'),'<html>cn</html>');
  await writeFile(join(directory,'build-info.json'),JSON.stringify({revision:'a'.repeat(40),siteEdition:'cn'}));
  const config={host:'127.0.0.1',port:0,publicOrigin:'http://127.0.0.1:39123',staticDir:directory,databasePath:join(directory,'rooms.sqlite'),env:{SITE_EDITION:'cn'}};
  await assert.rejects(createServer({...config,env:{NODE_ENV:'production'}}), /SITE_EDITION/);
  await assert.rejects(createServer({...config,env:{SITE_EDITION:'global',NODE_ENV:'production'}}), /SITE_EDITION/);
  await writeFile(join(directory,'security.sqlite'),'historical private audit remains untouched');
  let app=await createServer(config);let address=await app.listen();
  const clients=[];t.after(async()=>{for(const client of clients)client.close();await app.close();await rm(directory,{recursive:true,force:true});});
  const connect=async hello=>{
    const ws=new WebSocket(`ws://127.0.0.1:${address.port}/api/rooms/ABCDEFGH/ws`);clients.push(ws);const messages=[];
    ws.on('message',raw=>messages.push(JSON.parse(raw)));await new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject);});
    ws.send(JSON.stringify({type:'hello',version:2,host:true,token:'11111111-1111-4111-a111-111111111111',...hello}));
    const until=async predicate=>{const deadline=Date.now()+4000;while(Date.now()<deadline){const result=predicate();if(result)return result;await new Promise(r=>setTimeout(r,10));}throw Error('No server response');};
    await until(()=>messages.find(m=>m.type==='fatal'||m.data?.type==='state'));return {ws,messages,until};
  };
  const invalid=await connect({name:'自由名字',siteEdition:'global'});assert.match(invalid.messages.find(m=>m.type==='fatal').message,/固定昵称/);
  const valid=await connect({nicknameId:nicknameId(0),siteEdition:'global'});const initial=valid.messages.find(m=>m.data?.type==='state').data;
  assert.equal(initial.state.players[0].name,'天狼星');
  valid.ws.send(JSON.stringify({type:'send',data:{type:'action',requestId:'x',siteEdition:'global',action:{type:'chat',text:'blocked secret'}}}));
  await valid.until(()=>valid.messages.find(m=>m.data?.type==='error'));
  assert.equal(valid.messages.find(m=>m.data?.type==='error').data.message,COMMUNICATION_DISABLED);
  assert.doesNotMatch(JSON.stringify(valid.messages),/blocked secret/);
  await app.close();app=await createServer(config);address=await app.listen();
  const recovered=await connect({name:'旧客户端自由昵称'});const next=recovered.messages.find(m=>m.data?.type==='state').data;
  assert.equal(next.me,initial.me);assert.equal(next.state.players[0].nicknameId,nicknameId(0));
  const runtime=await (await fetch(`http://127.0.0.1:${address.port}/runtime-config.json?SITE_EDITION=global`)).json();
  assert.equal(runtime.siteEdition,'cn');assert.equal(runtime.backends.length,1);
  assert.equal(app.securityStore,null);
  assert.equal(await readFile(join(directory,'security.sqlite'),'utf8'),'historical private audit remains untouched');
  assert.equal((await fetch(`http://127.0.0.1:${address.port}/api/stationmaster/security`,{method:'POST'})).status,404);
  assert.deepEqual(await (await fetch(`http://127.0.0.1:${address.port}/api/security/health`)).json(),{ok:true,auditEnabled:false});
});


test('CN authenticated legacy browser migration cannot forge a policy marker to republish old text', async () => {
  const token='11111111-1111-4111-a111-111111111111';
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token));
  const hash=[...new Uint8Array(bytes)].map(n=>n.toString(16).padStart(2,'0')).join('');
  const store=new Map([['owner',hash]]),sockets=[];
  const ctx={getWebSockets:()=>sockets,setWebSocketAutoResponse(){},blockConcurrencyWhile:fn=>fn(),storage:{get:async k=>store.get(k),put:async(k,v)=>{for(const [key,value] of typeof k==='object'?Object.entries(k):[[k,v]])store.set(key,structuredClone(value));},setAlarm:async()=>{},deleteAlarm:async()=>{}}};
  const relay=new RoomRelay(ctx,{SITE_EDITION:'cn',DIRECTORY:{getByName:()=>({fetch:async()=>Response.json({})})}});
  const ws={data:{id:'socket',room:'ABCDEFGH',created:Date.now()},sent:[],deserializeAttachment(){return this.data;},serializeAttachment(v){this.data=v;},send(raw){this.sent.push(JSON.parse(raw));},close(){}};sockets.push(ws);
  const snapshot=createGame();addPlayer(snapshot,'old-host','旧自由昵称');snapshot.players[0].nicknameId=nicknameId(0);snapshot.cnPolicyVersion=1;snapshot.log=['历史别名 出牌'];snapshot.publicEvents=[{seq:1,time:Date.now(),text:'最早别名 改名为 历史别名'}];
  await relay.webSocketMessage(ws,JSON.stringify({type:'hello',version:2,host:true,token,snapshot,identities:{[token]:'old-host'}}));
  assert.equal(relay.authority.game.players[0].name,'天狼星');
  assert.doesNotMatch(JSON.stringify(ws.sent),/旧自由昵称|历史别名|最早别名/);
  assert.equal(relay.authority.game.players[0].id,'old-host');
});
