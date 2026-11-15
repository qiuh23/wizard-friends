import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { buildSync } from 'esbuild';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import postcss from 'postcss';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
mkdirSync('.local/component-tests', {recursive:true});
const modulePath = new URL('../.local/component-tests/home-redesign.mjs', import.meta.url);
writeFileSync(modulePath, buildSync({stdin:{contents:`export * from './src/ui/entry.tsx'; export * from './src/ui/chrome.tsx'; export * from './src/ui/rules-modal.tsx';`,resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',packages:'external',write:false,jsx:'automatic'}).outputFiles[0].contents);
const {HomeScreen, JoinRoomModal, RoomHeading, LobbyOperations, GameMenu, LobbyNavigation, LobbyReturnModal, RulesModal} = await import(modulePath.href);
const model = overrides => ({domestic:false,busy:false,nickname:'星河',lobbyURL:'https://magical-athlete.qiuh23.workers.dev/lobby/',joinOpen:false,joinDraft:'C-ABCD2345',roomInput:'',returnRooms:[],practiceSaved:false,publicCode:'C-ABCD2345',lobbyPanel:'players',isHost:true,practice:false,spectating:false,state:{phase:'lobby',players:[{id:'p0',name:'星河',online:true},{id:'p1',name:'玩家二',online:true},{id:'p2',name:'玩家三',online:true}],options:{deckMode:'standard',predictionMode:'public',strict:false,foresight:false,short:false},trick:[]},...overrides});
const render = (Component, value=model(),children) => renderToStaticMarkup(createElement(Component,{model:value},children));
const ids = html => [...html.matchAll(/<button[^>]*\bid="([^"]+)"/g)].map(m=>m[1]);

test('both editions keep three ordered primary actions and compact optional recovery outside that action group', () => {
  for(const domestic of [false,true]) for(const busy of [false,true]) for(const joinOpen of [false,true]) for(const recovery of [false,true]) {
    const html=render(HomeScreen,model({domestic,busy,joinOpen,returnRooms:recovery?[{room:'C-ABCD2345',role:'host'}]:[],practiceSaved:recovery}));
    const actions=html.match(/<nav class="menu-options"[^>]*>(.*?)<\/nav>/s)[1];
    assert.deepEqual(ids(actions),['create','join-menu','practice']);
    assert.equal((actions.match(/menu-primary/g)||[]).length,1);
    assert.match(actions,/id="create" class="menu-tile menu-primary"/);
    assert.match(actions,/<span>加入房间<\/span>/); assert.match(actions,/<span>单人练习<\/span>/);
    assert.doesNotMatch(html,/id="join-form"|id="room-input"|menu-choice/);
    assert.match(actions,new RegExp(`aria-expanded="${joinOpen}"`)); assert.match(actions,/aria-haspopup="dialog"/);
    assert.equal((actions.match(/class="ui-icon"/g)||[]).length,3);
    assert.equal(/<output id="nickname"/.test(html),domestic); assert.equal(/<input id="nickname"/.test(html),!domestic);
    assert.equal(/home-recovery/.test(html),recovery);
    if(recovery) { const links=html.match(/<nav class="home-recovery"[^>]*>(.*?)<\/nav>/s)[1]; assert.doesNotMatch(links,/menu-choice/); assert.match(links,/data-return-room="0"/);assert.match(links,/id="resume-practice"/);assert(html.indexOf('home-recovery')>html.indexOf('id="practice"')); }
    assert.doesNotMatch(html,/entry-context|home-title|data-lobby-navigation/);
  }
});

test('homepage retains the three illustrated sample cards and defaults its one online section closed', () => {
 const html=render(HomeScreen);
 assert.match(html,/aria-label="烛光牌桌"/);assert.equal((html.match(/class="card /g)||[]).length,3);
 assert.match(html,/<details class="home-directory"><summary>/);assert.doesNotMatch(html,/<details[^>]* open/);
 assert.match(html,/在线房间 · <span id="home-room-count">—<\/span>/);
 assert(html.indexOf('id="online-count"')<html.indexOf('</summary>'));
 assert(html.indexOf('home-room-list')>html.indexOf('</summary>'));
});

test('one consistent accessible return link uses the existing URL for every surface and edition', () => {
 for(const state of [null,{...model().state,phase:'lobby'},{...model().state,phase:'play'},{...model().state,phase:'finished'}]) for(const domestic of [false,true]) {
  const value=model({state,domestic,lobbyURL:domestic?'https://magical-athlete-online.cn/':'https://magical-athlete.qiuh23.workers.dev/lobby/'});
  const html=render(LobbyNavigation,value);assert.equal((html.match(/data-lobby-navigation/g)||[]).length,1);
  assert.match(html,/aria-label="返回游戏大厅" title="返回游戏大厅"/);assert(html.includes(`href="${value.lobbyURL}"`));
 }
 const root=read('src/ui/root.tsx'); assert.equal((root.match(/<LobbyNavigation /g)||[]).length,1);
 for(const Component of [HomeScreen,RoomHeading,GameMenu])assert.doesNotMatch(render(Component),/data-lobby-navigation|lobby-navigation/);
 assert.doesNotMatch(read('src/ui/chrome.tsx'),/className="lobby-navigation"/);
});

test('room heading and exit remain independent of return-to-lobby chrome', () => {
 for(const isHost of [false,true])for(const spectating of [false,true])for(const practice of [false,true]) {
  const value=model({isHost,spectating,practice});const html=render(RoomHeading,value,createElement(LobbyOperations,{model:value}));
  assert.equal((html.match(/id="leave"/g)||[]).length,1);assert.match(html,/玩家入座/);assert.match(html,/整局玩法/);
  assert.equal(/id="invite"/.test(html),!practice); assert.equal(/id="room-pause"/.test(html),isHost&&!spectating);assert.equal(/id="room-dissolve"/.test(html),isHost&&!spectating);
 }
});

test('return confirmation reuses the rules dialog shell and includes retention and original-link guidance', () => {
 const html=renderToStaticMarkup(createElement(LobbyReturnModal,{message:'房间按保留规则处理。'}));
 for(const content of [html,renderToStaticMarkup(createElement(RulesModal))]) {assert.match(content,/class="modal-backdrop"/);assert.match(content,/class="modal" role="dialog" aria-modal="true"/);}
 assert.match(html,/房间按保留规则处理/);assert.match(html,/原浏览器凭原链接回来/);
 assert.deepEqual(ids(html),['close-lobby-return','cancel-lobby-return','confirm-lobby-return']);
});
const main=read('src/main.js');
function modalFixture() {
 const events=[],doc={activeElement:null};
 const node=id=>({id,focus(){doc.activeElement=this;},closest:selector=>selector==='.modal'?panel:backdrop});
 const close=node('close'),cancel=node('cancel'),confirm=node('confirm'),trigger=node('trigger'),backdrop={},panel={querySelectorAll:()=>[close,cancel,confirm]};
 const map={'#close-lobby-return':close,'#cancel-lobby-return':cancel,'#confirm-lobby-return':confirm,'[data-lobby-navigation]':trigger};
 const ctx={$:key=>map[key],document:doc,lobbyReturnOpen:false,rulesOpen:true,state:{phase:'play'},roomDepartureText:()=> '暂离房间，不会解散。',floatingLayers:{closeOthers:()=>events.push('close-panels')},updateUIDraft:value=>events.push(value),persistRoom:()=>events.push('persist'),leaveRoom:()=>events.push('leave'),gameLobbyURL:()=> 'https://lobby.test/',location:{assign:value=>events.push(value)}};
 runInNewContext(main.slice(main.indexOf('function bindLobbyReturnModal()'),main.indexOf('function roomControl(')),ctx);
 return {ctx,doc,events,close,cancel,confirm,trigger,panel,backdrop};
}
test('return dialog cancels by button, close, mask and Escape, traps focus, and confirms once', () => {
 for(const dismissal of ['cancel','close','mask','escape']) {
  const f=modalFixture();f.ctx.setLobbyReturnOpen(true);assert.equal(f.ctx.lobbyReturnOpen,true);assert.equal(f.ctx.rulesOpen,false);assert.equal(f.doc.activeElement,f.cancel);
  f.backdrop.onclick({target:f.panel,currentTarget:f.backdrop});assert.equal(f.ctx.lobbyReturnOpen,true);
  f.close.focus();f.panel.onkeydown({key:'Tab',shiftKey:true,currentTarget:f.panel,preventDefault(){}});assert.equal(f.doc.activeElement,f.confirm);
  f.panel.onkeydown({key:'Tab',shiftKey:false,currentTarget:f.panel,preventDefault(){}});assert.equal(f.doc.activeElement,f.close);
  if(dismissal==='cancel')f.cancel.onclick();if(dismissal==='close')f.close.onclick();if(dismissal==='mask')f.backdrop.onclick({target:f.backdrop,currentTarget:f.backdrop});if(dismissal==='escape')f.panel.onkeydown({key:'Escape',preventDefault(){}});
  assert.equal(f.ctx.lobbyReturnOpen,false);assert.equal(f.doc.activeElement,f.trigger);assert(!f.events.includes('persist'));assert(!f.events.includes('leave'));
 }
 const f=modalFixture();f.ctx.setLobbyReturnOpen(true);f.ctx.setLobbyReturnOpen(true);f.confirm.onclick();f.confirm.onclick();
 assert.deepEqual(f.events.filter(v=>typeof v==='string'),['close-panels','persist','leave','https://lobby.test/']);
});

test('home return is direct; room return only opens confirmation; busy home cannot navigate', () => {
 const code=main.slice(main.indexOf("document.addEventListener('click', event => {\n  const control = event.target.closest?.('[data-lobby-navigation]')"),main.indexOf('\nfunction bindLobbyReturnModal()'));
 for(const inRoom of [false,true])for(const busy of [false,true]) {
  const events=[],ctx={document:{addEventListener:(type,handler)=>ctx.click=handler},state:inRoom?{}:null,busy,setLobbyReturnOpen:open=>events.push(open),gameLobbyURL:()=> 'https://lobby.test/',location:{assign:url=>events.push(url)}};
  runInNewContext(code,ctx);ctx.click({target:{closest:()=>({})},preventDefault(){}});
  assert.deepEqual(events,inRoom?[true]:busy?[]:['https://lobby.test/']);
 }
 assert.match(main,/function requestLeave\(\) \{\n  if \(confirm\(`\$\{roomDepartureText\(\)\}确定离开？`\)\) leaveRoom\('已离开，可从原浏览器返回恢复。'\);\n\}/);
});

test('join form is a standalone existing shell, with draft, status and only one cancel action', () => {
 for(const domestic of [false,true])for(const busy of [false,true]) {
  const value=model({domestic,busy,joinOpen:true,status:'房间未找到'});
  const home=render(HomeScreen,value), dialog=render(JoinRoomModal,value);
  assert.doesNotMatch(home,/id="join-form"|id="room-input"|id="cancel-connect"/);
  assert.match(dialog,/class="modal" role="dialog" aria-modal="true" aria-labelledby="join-title"/);
  assert.match(dialog,/value="C-ABCD2345"/);assert.match(dialog,/id="join-status"[^>]*>房间未找到/);
  assert.equal(/id="cancel-connect"/.test(dialog),busy);
  assert.equal(/id="join"[^>]*disabled/.test(dialog),busy);
 }
 const root=read('src/ui/root.tsx');
 assert.match(root,/!model.state && model.joinOpen && !model.rulesOpen && <JoinRoomModal/);
});

function joinFixture(overrides={}) {
 const events=[],doc={activeElement:null};
 const node=id=>({id,value:'C-ABCD2345',focus(){doc.activeElement=this;},closest:selector=>selector==='.modal'?panel:backdrop});
 const close=node('close'),input=node('input'),submit=node('submit'),trigger=node('trigger'),cancel=node('cancel'),nickname=node('nickname'),form={},backdrop={};
 const panel={querySelectorAll:()=>ctx.busy?[close,cancel]:[close,input,submit],contains:n=>[close,input,submit,cancel].includes(n)};
 const map={'#close-join':close,'#room-input':input,'#join-form':form,'#join-menu':trigger,'#cancel-connect':cancel,'#nickname':nickname};
 const ctx={$:key=>map[key],document:doc,state:null,busy:false,joinOpen:false,joinDraft:null,rulesOpen:true,settingsOpen:true,saveName:()=>true,
 floatingLayers:{closeOthers:()=>{events.push('close-panels');ctx.settingsOpen=false;}},updateUIDraft:value=>events.push(value),
 launch:host=>events.push(['launch',host]),leaveRoom:()=>events.push('cancel'),...overrides};
 runInNewContext(main.slice(main.indexOf('function bindJoinModal()'),main.indexOf('function bindRulesModal()')),ctx);
 return {ctx,events,doc,close,input,submit,trigger,cancel,nickname,form,backdrop,panel};
}
test('join dialog dismisses through X, mask and Esc; traps focus and preserves repeated draft edits', () => {
 for(const dismissal of ['close','mask','escape']) {
  const f=joinFixture();f.ctx.setJoinOpen(true);
  assert.equal(f.ctx.joinOpen,true);assert.equal(f.ctx.rulesOpen,false);assert.equal(f.ctx.settingsOpen,false);assert.equal(f.doc.activeElement,f.input);
  f.input.value='A-ABCD2345';f.input.oninput({target:f.input});
  f.backdrop.onclick({target:f.panel,currentTarget:f.backdrop});assert.equal(f.ctx.joinOpen,true);
  f.close.focus();f.panel.onkeydown({key:'Tab',shiftKey:true,preventDefault(){}});assert.equal(f.doc.activeElement,f.submit);
  f.panel.onkeydown({key:'Tab',shiftKey:false,preventDefault(){}});assert.equal(f.doc.activeElement,f.close);
  if(dismissal==='close')f.close.onclick();if(dismissal==='mask')f.backdrop.onclick({target:f.backdrop,currentTarget:f.backdrop});if(dismissal==='escape')f.panel.onkeydown({key:'Escape',preventDefault(){}});
  assert.equal(f.ctx.joinOpen,false);assert.equal(f.ctx.joinDraft,'A-ABCD2345');assert.equal(f.doc.activeElement,f.trigger);
  f.ctx.setJoinOpen(true);assert.equal(f.ctx.joinDraft,'A-ABCD2345');assert.equal(f.doc.activeElement,f.input);
  f.form.onsubmit({preventDefault(){}});assert.deepEqual(f.events.find(Array.isArray),['launch',false]);
 }
});
test('busy join cannot submit twice, dismissing exposes working cancel; missing nickname returns to its field', () => {
 const f=joinFixture();f.ctx.setJoinOpen(true);f.ctx.busy=true;f.ctx.bindJoinModal();f.form.onsubmit({preventDefault(){}});
 assert.equal(f.events.filter(Array.isArray).length,0);f.close.onclick();assert.equal(f.doc.activeElement,f.cancel);f.cancel.onclick();assert(f.events.includes('cancel'));
 const missing=joinFixture({saveName:()=>false});missing.ctx.setJoinOpen(true);missing.form.onsubmit({preventDefault(){}});
 assert.equal(missing.ctx.joinOpen,false);assert.equal(missing.doc.activeElement,missing.nickname);assert.equal(missing.events.filter(Array.isArray).length,0);
});

test('online summary reflects room count and retains current presence status', () => {
 const rooms={},badge={dataset:{}};const ctx={document:{querySelector:s=>s==='#home-room-count'?rooms:badge},onlinePresence:{rooms:[{room:'A'},{room:'B'}],count:3,status:'connected'},icon:()=>'<svg></svg>'};
 runInNewContext(main.slice(main.indexOf('function updateOnlineCount()'),main.indexOf('\nlet tableScene')),ctx);ctx.updateOnlineCount();assert.equal(rooms.textContent,'2');assert.match(badge.innerHTML,/约 3 人在线/);
 ctx.onlinePresence={count:null,status:'unavailable'};ctx.updateOnlineCount();assert.equal(rooms.textContent,'—');assert.match(badge.innerHTML,/连接不可用/);
});

test('portrait source budget gives the scene the majority and keeps one three-tile row', () => {
 const css=postcss.parse(read('src/home-dock.css')); const declarations=(selector, media=null)=>{const r={};css.walkRules(rule=>{if(rule.selector===selector && (media ? rule.parent.type==='atrule' && rule.parent.params===media : rule.parent.type==='root'))rule.walkDecls(d=>r[d.prop]=d.value)});return r;};
 assert.equal(declarations('body[data-screen="home"] .home-screen')['min-height'],'100dvh');
 assert.equal(declarations('body[data-screen="home"] .home-tools').position,'absolute');
 assert.equal(declarations('.lobby-return-header')['z-index'],'12');
 assert.equal(declarations('body[data-screen="home"] .home-directory .home-room-list').position,'absolute');
 assert.equal(declarations('body[data-screen="home"] .home-recovery')['white-space'],'nowrap');
 assert.equal(declarations('body[data-screen="home"] .home-screen .home-scene','(max-width:700px) and (orientation:portrait)').height,'calc(100dvh - 200px)');
 const menuCSS=postcss.parse(read('src/home-menu.css')),menu={};
 menuCSS.walkRules(rule=>{if(rule.selector==='.menu-options')rule.walkDecls(d=>menu[d.prop]=d.value);});
 assert.equal(menu.display,'grid');assert.equal(menu['grid-template-columns'],'repeat(3, minmax(0, 1fr))');
 assert.doesNotMatch(read('src/home-menu.css'),/menu-choice|menu-join/);
 for(const height of [568,667,740,844,932])for(const safeTop of [0,44])for(const safeBottom of [0,34])for(const busy of [false,true]) {
  // Source budget only, not a browser pixel result: nickname, one action row,
  // recovery, online summary, safe bottom and optional cancel. Header overlays.
  const dock=44+8+80+50+48+12+Math.max(12,safeBottom)+(busy?44:0);
  assert(dock+Math.max(10,safeTop)+54<height);
  assert((height-200)/height>.5);
 }
 assert.doesNotMatch(read('src/home-dock.css'),/\.table\s*\{|\.opponents|\.hand-section|\.lobby-panel|\.lobby-table|\.seats/);
});
