import test from 'node:test';
import assert from 'node:assert/strict';
import { trumpPresentation } from '../src/trump-display.js';

test('trump display uses the actual turned card, including a wizard after its suit is chosen', () => {
  const reveal = { id: 'blue-9', kind: 'number', suit: 'blue', rank: 9 };
  const numbered = trumpPresentation({ phase: 'bid', trump: 'blue', reveal });
  assert.equal(numbered.card, reveal);
  assert.equal(numbered.label, '本轮主牌：蓝色');
  assert.equal(numbered.compactLabel, '蓝色主牌');
  const wizard = { id: 'wizard-0', kind: 'wizard' };
  assert.equal(trumpPresentation({ phase: 'trump', trump: null, reveal: wizard }).status, 'pending');
  assert.equal(trumpPresentation({ phase: 'trump', trump: null, reveal: wizard }).compactLabel, 'W · 待庄家选色');
  const chosen = trumpPresentation({ phase: 'bid', trump: 'red', reveal: wizard });
  assert.equal(chosen.card, wizard);
  assert.equal(chosen.suit, 'red');
  assert.match(chosen.label, /巫师指定/);
  assert.equal(chosen.compactLabel, 'W → 红色主牌');
});

test('no-trump states distinguish jester, exhausted deck and monochrome without inventing a card', () => {
  const jester = { id: 'jester-0', kind: 'jester' };
  assert.equal(trumpPresentation({ phase: 'bid', trump: null, reveal: jester }).status, 'jester');
  assert.equal(trumpPresentation({ phase: 'bid', trump: null, reveal: jester }).compactLabel, 'J · 本轮无主牌');
  const exhausted = trumpPresentation({ phase: 'bid', trump: null, reveal: null });
  assert.equal(exhausted.status, 'exhausted');
  assert.equal(exhausted.card, null);
  assert.match(exhausted.label, /牌库已用尽/);
  assert.equal(exhausted.compactLabel, '无主牌 · 牌库用尽');
  const mono = trumpPresentation({ phase: 'bid', trump: null, reveal: null, options: { deckMode: 'mono' } });
  assert.equal(mono.card, null);
  assert.equal(mono.label, '无主牌 · 单色牌库');
  assert.equal(mono.compactLabel, '无主牌 · 单色');
});
