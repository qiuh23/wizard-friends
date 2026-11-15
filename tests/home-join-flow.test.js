import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { WebSocket } from 'ws';
import { createServer } from '../server/index.js';
import { createRoomTransport } from '../src/room-transport.js';
import { parseRoomCode } from '../src/backend-entry.js';
import { FOREIGN_INVITATION, migrateCNGame } from '../src/site-policy.js';
const source=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
const launchCode=source.slice(source.indexOf('function launch(host,'),source.indexOf('\nconst social ='));
const modalCode=source.slice(source.indexOf('function bindJoinModal()'),source.indexOf('function bindRulesModal()'));
async function until(check) { for(let i=0;i<400;i++) { if(check())return;await new Promise(resolve=>setTimeout(resolve,10)); } throw Error('Timed out waiting for actual room transport'); }

for(const edition of ['global','cn']) test(`${edition}: modal submit enters a real room, reconnects original seat and keeps error drafts`, async t=>{
 const directory=await mkdtemp(join(tmpdir(),'wizard-home-join-'));
 await writeFile(join(directory,'index.html'),'<html>join fixture</html>');
 await writeFile(join(directory,'build-info.json'),JSON.stringify({revision:'a'.repeat(40),siteEdition:edition}));
 const origin='http://192.0.2.10:8081';
 const app=await createServer({host:'127.0.0.1',port:0,publicOrigin:origin,staticDir:directory,databasePath:join(directory,'rooms.sqlite'),env:{SITE_EDITION:edition},onError(){}});
 const {port}=await app.listen();const transports=[];
 t.after(async()=>{transports.forEach(value=>value.stop());await app.close();await rm(directory,{recursive:true,force:true});});
 class Socket extends WebSocket { constructor(url){super(url,{origin});} }
 const connect=options=>{const value=createRoomTransport({...options,url:`ws://127.0.0.1:${port}/api/rooms/${options.room}/ws`,WebSocket:Socket,retryMs:10,maxRetryMs:20});transports.push(value);return value;};
 let hostState;
 const host=connect({host:true,room:'ABCD2345',token:crypto.randomUUID(),name:edition==='cn'?'':'房主',nicknameId:edition==='cn'?'wizard-cn-01':undefined,onData:value=>{if(value.type==='state')hostState=value.state;}});
 await until(()=>hostState);
 const currentBackend=edition==='cn'?'aliyun':'cloudflare',prefix=edition==='cn'?'A':'C';
 const doc={activeElement:null};const node=id=>({id,value:'',focus(){doc.activeElement=this;},closest:selector=>selector==='.modal'?panel:backdrop});
 const input=node('input'),close=node('close'),submit=node('submit'),trigger=node('trigger'),cancel=node('cancel'),form={},backdrop={};
 const panel={querySelectorAll:()=>[close,input,submit],contains:node=>[close,input,submit,cancel].includes(node)};
 const map={'#room-input':input,'#close-join':close,'#join-form':form,'#join-menu':trigger,'#cancel-connect':cancel};
 const statuses=[];
 const ctx={$:key=>map[key],document:doc,state:undefined,game:undefined,transport:null,roomEpoch:0,busy:false,joinOpen:false,joinDraft:null,rulesOpen:false,settingsOpen:false,
  practice:false,spectating:false,isHost:false,networkReady:false,me:'',room:'',nickname:'访客',token:crypto.randomUUID(),domestic:edition==='cn',selectedNicknameId:'wizard-cn-02',automaticName:false,
  seenEventSeq:null,selectedCard:null,pendingPlay:null,pendingSettlement:null,serverClockOffset:0,crypto,Date,
  saveName:()=>true,parseRoomCode:value=>parseRoomCode(value,currentBackend),backendId:()=>currentBackend,FOREIGN_INVITATION,migrateCNGame,
  floatingLayers:{closeOthers(){}},updateUIDraft(){},notify:message=>statuses.push(message),
  updateEventEffects(){},persistRoom(){},trumpReveal:{finish(){}},scoreBubbles:{finish(){}},
  createRoomTransport:connect,stopRoomTransport(){ctx.roomEpoch++;ctx.transport?.stop();},
  render(){if(ctx.state)ctx.joinOpen=false;},
  leaveRoom(message){ctx.roomEpoch++;ctx.transport?.stop();ctx.state=undefined;ctx.busy=false;statuses.push(message);},
 };
 runInNewContext(launchCode+'\n'+modalCode,ctx);
 ctx.setJoinOpen(true);input.value='bad';input.oninput({target:input});form.onsubmit({preventDefault(){}});
 assert.match(statuses.at(-1),/有效的 8 位房间码/);assert.equal(ctx.busy,false);assert.equal(ctx.joinOpen,true);assert.equal(ctx.joinDraft,'bad');
 input.value=`${prefix==='A'?'C':'A'}-ABCD2345`;form.onsubmit({preventDefault(){}});assert.equal(statuses.at(-1),FOREIGN_INVITATION);assert.equal(ctx.transport,null);
 input.value=`${prefix}-ABCD2345`;input.oninput({target:input});form.onsubmit({preventDefault(){}});form.onsubmit({preventDefault(){}});
 await until(()=>ctx.state?.players.length===2);assert.equal(transports.length,2,'busy duplicate submit creates no second connection');
 assert.equal(ctx.state.phase,'lobby');assert.equal(ctx.joinOpen,false);assert.equal(ctx.busy,false);const guest=ctx.me;
 ctx.transport.wake();await until(()=>ctx.networkReady && ctx.state.players.find(p=>p.id===guest)?.online);assert.equal(ctx.me,guest);assert.equal(ctx.state.players.length,2);
 ctx.leaveRoom('left');ctx.setJoinOpen(true);assert.equal(ctx.joinDraft,`${prefix}-ABCD2345`);
 host.closeRoom();await until(()=>app.contexts.get('ABCD2345')?.controller.authority?.closed);
 input.value=`${prefix}-ABCD2345`;input.oninput({target:input});form.onsubmit({preventDefault(){}});await until(()=>!ctx.busy);
 assert.equal(ctx.state,undefined);assert.equal(ctx.joinOpen,true);assert.equal(ctx.joinDraft,`${prefix}-ABCD2345`);assert.match(statuses.at(-1),/已关闭/);
 host.stop();
});
