import test from 'node:test';
import assert from 'node:assert/strict';
import { cardMark, cardMarksHTML, cardFaceCanvas, loadCardFace, preloadCardFaces } from '../src/card-face.js';
import { cardImage, loadedCardImage, loadCardImage } from '../src/card-art.js';
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

test('waiting-time warmup prepares every public face once, retains fallback on failure and retries', async t => {
  const originals = new Map(['Image', 'document'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  t.after(() => {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  });
  const attempts = new Map(), contexts = [], failedURL = cardImage({kind:'number',suit:'green',rank:13});
  let active = 0, peak = 0;
  globalThis.Image = class {
    set src(url) {
      this.url = url; attempts.set(url, (attempts.get(url) || 0) + 1);
      active++; peak = Math.max(peak, active);
      queueMicrotask(() => {
        if (url === failedURL && attempts.get(url) === 1) { active--; this.onerror(); }
        else this.onload();
      });
    }
    async decode() { this.decoded = true; active--; }
  };
  globalThis.document = { createElement(name) {
    assert.equal(name, 'canvas');
    const ctx = {
      draws: [], texts: [], fillRect() {}, strokeRect() {}, beginPath() {}, arc() {}, fill() {},
      fillText(text) { this.texts.push(text); }, drawImage(image) { this.draws.push(image); },
      measureText() { return {actualBoundingBoxAscent:20,actualBoundingBoxDescent:0,actualBoundingBoxLeft:0,actualBoundingBoxRight:20}; },
    };
    contexts.push(ctx); return {getContext() { return ctx; }};
  }};
  const wizard = {kind:'wizard'}, fallback = cardFaceCanvas(wizard);
  assert.equal(fallback.getContext('2d').draws.length, 0);
  assert.ok(fallback.getContext('2d').texts.includes('W'));
  const first = preloadCardFaces(); assert.equal(preloadCardFaces(), first);
  await first;
  assert.equal(attempts.size, 54); assert.equal(contexts.length, 54); assert.ok(peak <= 3);
  assert.equal(cardFaceCanvas({kind:'wizard',id:'another-copy'}), fallback);
  assert.ok(fallback.getContext('2d').draws.at(-1).decoded);
  const unavailable = {kind:'number',suit:'green',rank:13}, failedCanvas = cardFaceCanvas(unavailable);
  assert.equal(failedCanvas.getContext('2d').draws.length, 0);
  assert.ok(failedCanvas.getContext('2d').texts.includes('13'));

  // HTML may decode a previously unavailable asset before the next 3D use.
  await loadCardImage(unavailable);
  assert.equal(cardFaceCanvas(unavailable), failedCanvas);
  assert.equal(failedCanvas.getContext('2d').draws.at(-1), loadedCardImage(unavailable));
  await preloadCardFaces();
  assert.equal(attempts.get(failedURL), 2);
  assert.ok([...attempts].every(([url, count]) => count === (url === failedURL ? 2 : 1)));
  const drawCount = contexts.reduce((sum,ctx) => sum + ctx.draws.length, 0);
  await preloadCardFaces();
  assert.equal(contexts.reduce((sum,ctx) => sum + ctx.draws.length, 0), drawCount);
  for (const card of deck()) {
    const canvas = cardFaceCanvas(card);
    assert.equal(canvas.width, 320); assert.equal(canvas.height, 480);
    assert.equal(canvas.getContext('2d').draws.at(-1), loadedCardImage(card));
    assert.equal(await loadCardFace(card), canvas);
  }
});
