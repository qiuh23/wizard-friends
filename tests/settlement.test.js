import test from 'node:test';
import assert from 'node:assert/strict';
import { settlementHTML } from '../src/settlement.js';
import { createGame, addPlayer, act, viewFor } from '../src/game.js';
import { DEFAULT_OPTIONS } from '../src/rules-options.js';

const game = phase => ({ phase, round:2, lastWinner:1, dealer:0, options:{deckMode:'standard'},
  players:[{id:'a',name:'青山<长名>',score:20,online:true},{id:'b',name:'青川',score:30,online:true},{id:'c',name:'云舒',score:-10,online:true}],
  trick:[{player:0,card:{kind:'number',suit:'blue',rank:13}},{player:1,card:{kind:'number',suit:'red',rank:2}}],trump:'red',
  history:[{round:2,result:[{id:'a',bid:0,won:0,delta:20,total:20},{id:'b',bid:1,won:1,delta:30,total:30},{id:'c',bid:1,won:0,delta:-10,total:-10}]}] });
test('trick results stay on the felt for the shared review with no manual next button', () => {
  const g=game('trickEnd');
  for (const context of [{me:'a',practice:true,isHost:true},{me:'a',isHost:true},{spectating:true}]) {
    const html=settlementHTML(g,context);
    assert.match(html,/青川 赢得本墩/);
    assert.match(html,/id="trick-review-timer"/);
    assert.doesNotMatch(html,/id="next"|settlement-panel|settlement-details|须跟|自由出牌/);
  }
});

test('round results use a labelled outcome and signed score; the ledger owns details', () => {
  const html=settlementHTML(game('roundEnd'),{me:'a',isHost:true});
  assert.match(html,/命中<\/span><strong>\+20/);
  assert.match(html,/预测 0，实赢 0，得分 \+20，累计 20/);
  assert.match(html,/下轮自动发牌/);
  assert.doesNotMatch(html,/id="next"|settlement-panel|settlement-details|settlement-actions|20 \+ 10/);
  assert.match(settlementHTML(game('roundEnd'),{me:'c'}),/未中<\/span><strong>-10/);
});

test('finished, spectator, offline and continuation preserve their authority boundaries', () => {
  const g=game('finished');
  let html=settlementHTML(g,{me:'a',isHost:true});
  assert.match(html,/青川 赢得本局/);assert.match(html,/id="rematch"/);assert.doesNotMatch(html,/id="next"/);
  assert.doesNotMatch(html,/id="finished-dissolve"/);
  html=settlementHTML(g,{me:'a'});assert.doesNotMatch(html,/id="rematch"|id="next"|id="finished-dissolve"/);
  assert.doesNotMatch(settlementHTML(g,{me:'',isHost:true,spectating:true}),/id="finished-dissolve"/);
  g.phase='roundEnd';g.players[1].online=false;
  html=settlementHTML(g,{me:'a',isHost:true});assert.match(html,/等待重连/);assert.doesNotMatch(html,/<button/);
  assert.doesNotMatch(settlementHTML(g,{me:'',spectating:true}),/id="next"|personal-result|得分/);
  g.lifecycle={closeAfterRound:true,resultsConfirmed:[]};
  html=settlementHTML(g,{me:'a',isHost:true});assert.match(html,/id="confirm-results"/);assert.doesNotMatch(html,/id="next"/);
  assert.doesNotMatch(settlementHTML(g,{me:'',spectating:true}),/id="confirm-results"/);
  g.lifecycle.resultsConfirmed=['a'];assert.match(settlementHTML(g,{me:'a'}),/disabled>已确认/);
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
