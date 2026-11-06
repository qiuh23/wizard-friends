import test from 'node:test';
import assert from 'node:assert/strict';
import { graphemes, fallbackGraphemes, avatarCharacter, shortName } from '../src/graphemes.js';
import { validateName } from '../src/player-names.js';
import { bidStatus, bidPrompt } from '../src/bid-status.js';
import { createGame, addPlayer, act, viewFor, spectatorView } from '../src/game.js';
import { DEFAULT_OPTIONS } from '../src/rules-options.js';

test('avatars and shortened names preserve complete emoji and supplementary characters, including fallback',()=>{
  for(const glyph of ['汉','A','🐧','👍🏽','🇨🇳','👨‍👩‍👧‍👦','𠮷','e\u0301','👩🏾‍🚀']) {
    assert.equal(avatarCharacter(glyph+'好友'),glyph);
    assert.equal(shortName(glyph+'好友'),glyph+'好');
    assert.deepEqual(graphemes(glyph+'X'),[glyph,'X']);
    assert.deepEqual(fallbackGraphemes(glyph+'X'),[glyph,'X']);
    assert.equal(validateName(glyph+'好友'),(glyph+'好友').normalize('NFC'));
  }
  assert.deepEqual(fallbackGraphemes('🇨🇳🇺🇸'),['🇨🇳','🇺🇸']);
  for(const unsafe of ['a\u200db','👩\u200dA','\u200d👩','👩\u200d','a\u202eb','a\u200bb','a\nb'])assert.throws(()=>validateName(unsafe));
});

function bidding(mode) {
  const g=createGame();for(let i=0;i<3;i++)addPlayer(g,'p'+i,'玩家'+i);
  act(g,'p0',{type:'start',options:{...DEFAULT_OPTIONS,predictionMode:mode}});
  if(g.phase==='trump')act(g,g.players[g.turn].id,{type:'trump',suit:'blue'});
  return g;
}
test('public prediction follows the current player and clears after submission and phase change',()=>{
  const g=bidding('public'),id=g.players[g.turn].id;
  let view=viewFor(g,id);
  assert.equal(bidStatus(view,id),'waiting');
  assert.equal(view.players.filter(p=>bidStatus(view,p.id)==='waiting').length,1);
  assert.equal(bidPrompt(view,id),'请预测');
  act(g,id,{type:'bid',value:0});view=viewFor(g,id);
  assert.equal(bidStatus(view,id),'submitted');
  assert.equal(bidStatus(view,g.players[g.turn].id),'waiting');
  g.phase='play';assert.equal(bidStatus(viewFor(g,id),id),'');
});
for(const mode of ['hidden','secret'])test(`${mode}: pending/submitted state survives public projections without exposing other bids`,()=>{
  const g=bidding(mode),view=()=>spectatorView(g);
  assert.equal(view().players.filter(p=>bidStatus(view(),p.id)==='waiting').length,3);
  act(g,'p0',{type:'bid',value:1});
  const watcher=view();
  assert.equal(watcher.players[0].bid,null);assert.equal(watcher.players[0].bidSubmitted,true);
  assert.equal(bidStatus(watcher,'p0'),'submitted');assert.equal(bidStatus(watcher,'p1'),'waiting');
  assert.equal(bidPrompt(watcher,''),'等待尚未提交的玩家预测');
  assert.equal(bidStatus({...watcher,lifecycle:{paused:true}},'p1'),'held');
  assert.equal(bidStatus({...watcher,lifecycle:{reconnecting:true}},'p1'),'held');
  assert.equal(bidStatus(watcher,'p1',{connected:false}),'held');
  assert.equal(bidStatus(viewFor(g,'p0'),'p0'),'submitted');
  act(g,'p1',{type:'bid',value:0});act(g,'p2',{type:'bid',value:0});
  assert.equal(g.phase,'play');assert.ok(view().players.every(p=>bidStatus(view(),p.id)===''));
});
