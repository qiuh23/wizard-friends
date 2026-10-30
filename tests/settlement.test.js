import test from 'node:test';
import assert from 'node:assert/strict';
import { settlementHTML } from '../src/settlement.js';
import { createGame, addPlayer, act, viewFor } from '../src/game.js';
import { DEFAULT_OPTIONS } from '../src/rules-options.js';

const game = phase => ({ phase, round:2, lastWinner:1, dealer:0, options:{deckMode:'standard'},
  players:[{id:'a',name:'青山<长名>',score:20,online:true},{id:'b',name:'青川',score:30,online:true},{id:'c',name:'云舒',score:-10,online:true}],
  trick:[{player:0,card:{kind:'number',suit:'blue',rank:13}},{player:1,card:{kind:'number',suit:'red',rank:2}}],trump:'red',
  history:[{round:2,result:[{id:'a',bid:0,won:0,delta:20,total:20},{id:'b',bid:1,won:1,delta:30,total:30},{id:'c',bid:1,won:0,delta:-10,total:-10}]}] });
test('trick settlement separates concise winner and next action from folded winning explanation', () => {
  const g=game('trickEnd'), html=settlementHTML(g,{me:'a',practice:true,isHost:true});
  assert.match(html,/青川 赢得本墩/);
  assert.match(html,/下一墩 青川 首攻/);
  assert.match(html,/id="next"/);
  assert.match(html,/<details class="settlement-details"><summary>查看详情/);
  assert.doesNotMatch(html,/<details[^>]*open/);
  assert.match(html,/settlement-details-body[\s\S]*红色主牌 2/);
  assert.doesNotMatch(html,/须跟|自由出牌|personal-result/);
  assert.doesNotMatch(settlementHTML(g,{me:'a',isHost:true}),/id="next"/);
  assert.match(settlementHTML(g,{me:'a',isHost:true}),/id="trick-review-timer"/);
});
test('round settlement has two-line personal score and keeps formula/history folded', () => {
  const html=settlementHTML(game('roundEnd'),{me:'a',isHost:true});
  assert.match(html,/预测命中<\/b><strong>\+20 分/);
  assert.match(html,/预测 0 · 实赢 0 · 累计 20/);
  assert.match(html,/开始下一轮/);
  assert.doesNotMatch(html,/赢得本墩|下一墩|win-reason/);
  const body=html.indexOf('settlement-details-body');
  assert.ok(html.indexOf('预测命中：20')>body);
  assert.ok(html.indexOf('青山&lt;长名&gt; · 你')>body);
  assert.ok(html.indexOf('settlement-actions')>body);
  assert.match(settlementHTML(game('roundEnd'),{me:'c'}),/预测未中<\/b><strong>-10 分/);
});
test('finished, host, guest, spectator, offline and continuation keep distinct actions', () => {
  const g=game('finished');
  let html=settlementHTML(g,{me:'a',isHost:true});
  assert.match(html,/青川 赢得本局/);assert.match(html,/id="rematch"/);assert.doesNotMatch(html,/id="next"/);
  assert.match(html,/<div class="settlement-actions">[\s\S]*id="finished-dissolve" class="danger">解散房间/);
  html=settlementHTML(g,{me:'a'});assert.doesNotMatch(html,/id="rematch"|id="next"|id="finished-dissolve"/);
  assert.doesNotMatch(settlementHTML(g,{me:'',isHost:true,spectating:true}),/id="finished-dissolve"/);
  g.phase='roundEnd';g.players[1].online=false;
  html=settlementHTML(g,{me:'a',isHost:true});assert.match(html,/id="next" class="primary" disabled>等待玩家重连/);assert.doesNotMatch(html,/id="finished-dissolve"/);
  assert.doesNotMatch(settlementHTML(g,{me:'',spectating:true}),/id="next"|personal-result/);
  g.lifecycle={closeAfterRound:true,resultsConfirmed:[]};
  html=settlementHTML(g,{me:'a',isHost:true});assert.match(html,/id="confirm-results"/);assert.doesNotMatch(html,/id="next"/);
  assert.doesNotMatch(settlementHTML(g,{me:'',spectating:true}),/id="confirm-results"/);
  g.lifecycle.resultsConfirmed=['a'];assert.match(settlementHTML(g,{me:'a'}),/disabled>已确认/);
  g.lifecycle=null;g.players[1].online=true;
  assert.match(settlementHTML(g,{me:'a',isHost:true,pending:true}),/disabled aria-busy="true">正在提交/);
  assert.equal(settlementHTML({...g,phase:'play'},{me:'a',isHost:true}),'');
});

test('finished results show final ranking and last-round scores outside folded details, including tied winners', () => {
  const g = game('finished');
  g.players[0].score = 30;
  const before = structuredClone(g);
  const html = settlementHTML(g, { me:'a', isHost:true });
  const final = html.slice(html.indexOf('class="final-results"'), html.indexOf('<div class="settlement-summary">'));
  assert.match(final, /最终分数 · 共 2 轮/);
  assert.match(final, /青山&lt;长名&gt; · 你/);
  assert.match(final, /class="final-bid-won">0 \/ 0/);
  assert.match(final, /class="final-delta">\+20/);
  assert.match(final, /class="final-total">30/);
  assert.deepEqual([...final.matchAll(/class="final-rank">(\d+)/g)].map(match => Number(match[1])), [1,1,3]);
  assert.match(html, /青山&lt;长名&gt;、青川 并列获胜/);
  assert.doesNotMatch(final, /<details/);
  assert.deepEqual(g, before, 'displaying final scores never mutates authoritative settlement');
  assert.doesNotMatch(settlementHTML(game('roundEnd'), { me:'a' }), /final-results/);
  assert.match(settlementHTML(g, { spectating:true }), /class="final-score-row" data-player="a"/);
});

test('a completed quick match announces actual fifth-round results and final totals before rematch', () => {
  const g = createGame();
  for (const id of ['a','b','c']) addPlayer(g, id, id);
  act(g, 'a', { type:'start', options:{ ...DEFAULT_OPTIONS, short:true } }, () => .5);
  for (let guard = 0; g.phase !== 'finished' && guard < 200; guard++) {
    const actor = g.players[g.turn].id;
    const view = viewFor(g, actor);
    const action = g.phase === 'trump' ? { type:'trump', suit:'blue' }
      : g.phase === 'bid' ? { type:'bid', value:view.bids[0] }
      : g.phase === 'play' ? { type:'play', card:view.legal[0] } : { type:'next' };
    act(g, action.type === 'next' ? 'a' : actor, action, () => .5);
  }
  assert.equal(g.phase, 'finished');
  assert.equal(g.history.length, 5);
  const before = structuredClone(g);
  const html = settlementHTML(g, { me:'a', isHost:true, practice:true });
  const final = html.slice(html.indexOf('class="final-results"'), html.indexOf('<div class="settlement-summary">'));
  assert.match(final, /最终分数 · 共 5 轮/);
  for (const result of g.history.at(-1).result) {
    const row = final.split(`data-player="${result.id}">`)[1].split('</tr>')[0];
    assert.ok(row.includes(`class="final-bid-won">${result.bid} / ${result.won}`));
    assert.ok(row.includes(`class="final-delta">${result.delta >= 0 ? '+' : ''}${result.delta}`));
    assert.ok(row.includes(`class="final-total">${result.total}`));
  }
  assert.match(html, /id="rematch"/);
  assert.deepEqual(g, before);
});
