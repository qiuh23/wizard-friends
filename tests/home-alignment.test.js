import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { buildSync } from 'esbuild';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { copyInvitation } from '../src/share-link.js';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
mkdirSync('.local/component-tests', { recursive: true });
const modulePath = new URL('../.local/component-tests/home-alignment.mjs', import.meta.url);
writeFileSync(modulePath, buildSync({ stdin: {contents: `export * from './src/ui/entry.tsx'; export * from './src/ui/chrome.tsx'; export * from './src/ui/rules-modal.tsx';`, resolveDir: process.cwd()}, bundle: true, platform: 'node', format: 'esm', packages: 'external', write: false, jsx: 'automatic' }).outputFiles[0].contents);
const { HomeScreen, RoomHeading, LobbyOperations, LobbyStart, RulesModal, RulesButton, GameMenu } = await import(modulePath.href);
const model = overrides => ({ domestic: false, busy: false, nickname: '星河', lobbyURL: '/', joinOpen: false, joinDraft: 'C-ABCD2345', roomInput: '', returnRooms: [], practiceSaved: false, publicCode: 'C-ABCD2345', lobbyPanel: 'players', isHost: true, practice: false, spectating: false, state: { phase: 'lobby', players: [{id:'p0',name:'星河',online:true},{id:'p1',name:'玩家二',online:true},{id:'p2',name:'玩家三',online:true}], options: {deckMode:'standard',predictionMode:'public',strict:false,foresight:false,short:false}, trick:[] }, ...overrides });
const render = (Component, value = model(), children) => renderToStaticMarkup(createElement(Component, {model:value}, children));
const text = html => html.replace(/<[^>]*>/g, '');
const ids = html => [...html.matchAll(/<button[^>]*\bid="([^"]+)"/g)].map(match => match[1]);

test('both home editions retain identity and exactly ordered primary entries, including recovery states', () => {
  for (const domestic of [true, false]) for (const recovery of [false, true]) for (const joinOpen of [false, true]) {
    const html = render(HomeScreen, model({domestic, joinOpen, returnRooms: recovery ? [{room:'C-ABCD2345',role:'host'}] : [], practiceSaved: recovery}));
    const actions = html.match(/<nav class="menu-options"[^>]*>(.*?)<\/nav>/s)[1];
    assert.deepEqual(ids(actions), ['create','join-menu','join','practice']);
    assert.equal((actions.match(/menu-primary/g) || []).length, 1);
    assert.match(actions, /id="create" class="menu-choice menu-primary"[^>]*>创建房间/);
    assert.match(actions, /id="join-menu"[^>]*>加入房间/);
    assert.match(actions, /id="practice"[^>]*>单人练习/);
    assert.match(actions, new RegExp(`aria-expanded="${joinOpen}"`));
    assert.equal(/id="join-form"[^>]*hidden/.test(actions), !joinOpen);
    assert.match(actions, /value="C-ABCD2345"/);
    assert(html.indexOf('home-room-list') > html.indexOf('id="practice"'));
    assert.equal(/<output id="nickname"/.test(html), domestic);
    assert.equal(/<input id="nickname"/.test(html), !domestic);
    assert.equal(/id="resume-practice"/.test(html), recovery);
    assert.equal(/data-return-room="0"/.test(html), recovery);
    if (recovery) assert(html.indexOf('home-recovery') > html.indexOf('id="practice"'));
  }
});

test('room header keeps copy code on left and invitation then exit on right without duplicate exit', () => {
  for (const isHost of [true,false]) for (const spectating of [true,false]) for (const practice of [true,false]) {
    const value = model({isHost,spectating,practice});
    const html = render(RoomHeading, value, createElement(LobbyOperations,{model:value}));
    const actions = html.match(/<div class="room-buttons">(.*?)<\/div>/s)[1];
    assert.deepEqual(ids(actions), practice ? ['leave'] : ['invite','leave']);
    assert.equal((html.match(/id="leave"/g)||[]).length, 1);
    assert.match(actions, /退出房间/);
    assert.equal(/id="copy-room-code"/.test(html), !practice);
    if (!practice) { assert.match(html, /aria-label="复制房间码" title="复制房间码">C-ABCD2345/); assert(html.indexOf('id="copy-room-code"') < html.indexOf('room-buttons')); assert.match(actions,/邀请朋友/); }
    assert.equal(/id="room-pause"/.test(html), isHost && !spectating);
    assert.equal(/id="room-dissolve"/.test(html), isHost && !spectating);
    assert.match(html, /玩家入座/); assert.match(html,/整局玩法/);
  }
});

test('start wording and all preexisting readiness gates stay intact', () => {
  assert.match(render(LobbyStart), /id="start" class="primary">开始游戏<\/button>/);
  const value = model(); value.state.players.length = 2;
  assert.match(render(LobbyStart,value), /id="start" class="primary" disabled="">开始游戏/);
  assert.match(text(render(LobbyStart,value)), /还差 1 人/);
  value.state.players.push({name:'离线玩家',online:false});
  assert.match(text(render(LobbyStart,value)), /等待玩家重连/);
  assert.doesNotMatch(render(LobbyStart,model({isHost:false})), /id="start"/);
});

test('rules wording and public-room empty wording align without changing in-game action controls', () => {
  assert.match(render(RulesModal), /id="rule-title">玩法规则<\/h2>/);
  assert.match(render(RulesButton), /aria-label="玩法规则" title="玩法规则"/);
  assert.match(read('src/room-directory.js'), /class="room-directory-empty" role="status" hidden>暂无公开房间/);
  const html = render(GameMenu,model({state:{...model().state,phase:'play'}}));
  assert.match(html,/aria-label="离开房间"/); assert.match(html,/aria-label="复制邀请链接"/);
  assert.equal((html.match(/id="leave"/g)||[]).length,1);
});

const main = read('src/main.js');
test('actual inline join handlers keep input draft through repeated opening and submit once', () => {
  const nodes = Object.fromEntries(['#join-form','#room-input','#join-menu'].map(k=>[k,{focus(){this.focused=true;},setAttribute(k,v){this[k]=v;}}]));
  let launches = 0, prevented = 0;
  const ctx = { $:key=>nodes[key], joinOpen:false, joinDraft:'', launch:creating=>{assert.equal(creating,false);launches++;} };
  runInNewContext(main.slice(main.indexOf("    $('#join-form').onsubmit"),main.indexOf("    $('#practice').onclick")),ctx);
  nodes['#room-input'].oninput({target:{value:'A-ABCD2345'}});
  for(let i=0;i<4;i++) {nodes['#join-menu'].onclick(); assert.equal(nodes['#join-form'].hidden, i%2 === 1);}
  assert.equal(ctx.joinDraft,'A-ABCD2345'); assert.equal(nodes['#room-input'].focused,true);
  nodes['#join-form'].onsubmit({preventDefault(){prevented++;}}); assert.equal(launches,1); assert.equal(prevented,1);
});

test('actual rules handlers support close, mask-only dismissal, Esc, focus return and repeated opening', () => {
  const backdrop = {}, panel = {querySelectorAll:()=>[close,link]}, close = {focus(){doc.activeElement=this;},closest:s=>s==='.modal'?panel:backdrop}, link = {focus(){doc.activeElement=this;}}, trigger={getClientRects:()=>[{}],focus(){doc.activeElement=this;}};
  const doc={activeElement:null,addEventListener(type,callback){this.keydown=callback;}};
  let closedLayers=0;
  const ctx={ $:key=>({'#close-rules':close,'#rules':trigger}[key]),document:doc,rulesOpen:false,updateUIDraft(){},floatingLayers:{closeOthers(){closedLayers++;}} };
  runInNewContext(main.slice(main.indexOf('function bindRulesModal()'),main.indexOf('function updateSocialRegions()')),ctx);
  runInNewContext(main.match(/document\.addEventListener\('keydown', e => \{ if \(e\.key === 'Escape' && rulesOpen\) setRulesOpen\(false\); \}\);/)[0],ctx);
  for(const dismiss of [()=>close.onclick(),()=>backdrop.onclick({target:backdrop,currentTarget:backdrop}),()=>doc.keydown({key:'Escape'})]) {
    ctx.setRulesOpen(true); assert.equal(ctx.rulesOpen,true); assert.equal(doc.activeElement,close);
    backdrop.onclick({target:panel,currentTarget:backdrop}); assert.equal(ctx.rulesOpen,true);
    doc.keydown({key:'Enter'}); assert.equal(ctx.rulesOpen,true);
    panel.onkeydown({key:'Tab',shiftKey:true,currentTarget:panel,preventDefault(){}}); assert.equal(doc.activeElement,link);
    panel.onkeydown({key:'Tab',shiftKey:false,currentTarget:panel,preventDefault(){}}); assert.equal(doc.activeElement,close);
    dismiss(); assert.equal(ctx.rulesOpen,false); assert.equal(doc.activeElement,trigger);
  }
  assert.equal(closedLayers,3);
});

function fakeDocument() {
  const elements=[];
  const document={createElement(tag){const node={tag,children:[],attributes:{},events:{},setAttribute(k,v){this.attributes[k]=v;},addEventListener(k,v){this.events[k]=v;},append(...nodes){this.children.push(...nodes);},remove(){this.removed=true;},focus(){this.focused=true;},select(){this.selected=true;}};elements.push(node);return node;},querySelector(selector){return elements.find(e=>e.id===selector.slice(1) && !e.removed);}};
  document.body=document.createElement('body'); return document;
}

test('code copy uses the displayed same-site code and invitation remains the complete original URL', async () => {
  const handlers={},copied=[],notices=[];
  const ctx={$:key=>({addEventListener(type,fn){handlers[key]=fn;}}),uiModel:()=>({publicCode:'A-ABCD2345'}),invitation:'https://wizard.magical-athlete-online.cn/?room=A-ABCD2345',copyInvitation:async (...args)=>{copied.push(args);return true;},notify:v=>notices.push(v)};
  runInNewContext(main.slice(main.indexOf("  $('#copy-room-code')?.addEventListener"),main.indexOf("  $('#leave').onclick")),ctx);
  await handlers['#copy-room-code'](); await handlers['#invite']();
  assert.equal(copied[0][0],'A-ABCD2345'); assert.equal(copied[0][1].kind,'room-code');
  assert.equal(copied[1][0],ctx.invitation); assert.equal(copied[1].length,1);
  assert.deepEqual(notices,['房间码已复制。','邀请链接已复制，发给朋友吧。']);
  const writes=[]; assert.equal(await copyInvitation('C-ABCD2345',{clipboard:{writeText:async value=>writes.push(value)},kind:'room-code'}),true); assert.deepEqual(writes,['C-ABCD2345']);
});

test('copy fallback selects code with accurate labels and retains original invitation fallback', async () => {
  for(const kind of ['room-code','invitation']) {
    const document=fakeDocument(),value=kind==='room-code'?'A-ABCD2345':'https://example.test/?room=A-ABCD2345';
    assert.equal(await copyInvitation(value,{clipboard:null,document,kind}),false);
    const dialog=document.querySelector('#share-link-dialog'),input=document.querySelector('#share-link-text');
    assert.equal(document.querySelector('#share-link-title').textContent,kind==='room-code'?'复制房间码':'复制邀请链接');
    assert.equal(input.attributes['aria-label'],kind==='room-code'?'房间码':'完整邀请链接');
    assert.equal(input.value,value); assert(input.readOnly && input.focused && input.selected);
    dialog.events.keydown({key:'Escape'}); assert(dialog.removed);
  }
});
