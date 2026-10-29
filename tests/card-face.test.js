import test from 'node:test';
import assert from 'node:assert/strict';
import { cardMark, cardMarksHTML } from '../src/card-face.js';
import { deck, SUIT_NAMES } from '../src/game.js';
import { TRUMP_COLORS } from '../src/trump-style.js';

test('every face identifies its rule suit independently of the illustration palette', () => {
  for (const card of deck()) {
    const mark = cardMark(card);
    if (card.kind === 'number') {
      assert.equal(mark.name, SUIT_NAMES[card.suit].split(' · ')[0]);
      assert.equal(mark.color, TRUMP_COLORS[card.suit]);
      assert.equal(mark.value, String(card.rank));
    } else {
      assert.equal(mark.name, card.kind === 'wizard' ? '巫师' : '小丑');
      assert.equal(mark.value, card.kind === 'wizard' ? 'W' : 'J');
    }
    assert.ok(mark.symbol);
    assert.match(cardMarksHTML(card), new RegExp(`<small>${mark.symbol}</small>`));
    assert.ok(!cardMarksHTML(card).includes(mark.name));
  }
});

test('yellow keeps a consistent color without printing color words on the face', () => {
  for (let rank = 1; rank <= 13; rank++) {
    const mark = cardMark({ kind: 'number', suit: 'yellow', rank });
    assert.equal(mark.name, '黄');
    assert.equal(mark.color, '#f3cf66');
    assert.doesNotMatch(cardMarksHTML({ kind: 'number', suit: 'yellow', rank }), /黄|黄色/);
  }
});
