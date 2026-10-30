import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { cardImage, loadCardImage, loadedCardImage } from '../src/card-art.js';
import { deck } from '../src/game.js';

test('the 60-card deck maps to exactly the 54 supplied illustrations', () => {
  const cards = deck();
  const urls = new Set(cards.map(cardImage));
  assert.equal(cards.length, 60);
  assert.equal(urls.size, 54);
  const files = readdirSync(new URL('../src/assets/cards/', import.meta.url)).filter(f => f.endsWith('.svg'));
  assert.deepEqual([...urls].map(url => new URL(url).pathname.split('/').at(-1)).sort(), files.sort());
  for (const card of cards) {
    const filename = card.kind === 'number'
      ? `${card.suit}-${String(card.rank).padStart(2, '0')}.svg` : `${card.kind}.svg`;
    assert.ok(cardImage(card).endsWith(`/${filename}`));
  }
  assert.equal(cardImage({ kind: 'wizard', id: 'sample-wizard' }), cardImage({ kind: 'wizard', id: 'wizard-3' }));
});

test('concurrent face requests share one decoded illustration and a failed load can retry', async t => {
  const images = [];
  const original = Object.getOwnPropertyDescriptor(globalThis, 'Image');
  t.after(() => { if (original) Object.defineProperty(globalThis, 'Image', original); else delete globalThis.Image; });
  globalThis.Image = class {
    constructor() { images.push(this); }
    async decode() { this.decoded = true; }
  };
  const card = { kind:'wizard' };
  const first = loadCardImage(card), second = loadCardImage({kind:'wizard',id:'another-copy'});
  assert.equal(loadedCardImage(card), null);
  assert.equal(first, second); assert.equal(images.length, 1);
  await images[0].onload();
  assert.equal(await first, images[0]); assert.equal(images[0].decoded, true);
  assert.equal(loadedCardImage(card), images[0]);
  assert.equal(await loadCardImage(card), images[0]); assert.equal(images.length, 1);
  const failed = loadCardImage({kind:'jester'});
  images[1].onerror(); await assert.rejects(failed, /加载失败/);
  assert.equal(loadedCardImage({kind:'jester'}), null);
  const retry = loadCardImage({kind:'jester'});
  assert.equal(images.length, 3); await images[2].onload();
  assert.equal(await retry, images[2]);
});

test('an undecodable image is never exposed as a ready face and can be retried', async t => {
  const images = [];
  const original = Object.getOwnPropertyDescriptor(globalThis, 'Image');
  t.after(() => { if (original) Object.defineProperty(globalThis, 'Image', original); else delete globalThis.Image; });
  globalThis.Image = class {
    constructor() { images.push(this); }
    async decode() { if (images.indexOf(this) === 0) throw Error('bad image'); }
  };
  const card = {kind:'number',suit:'yellow',rank:13}, failed = loadCardImage(card);
  await images[0].onload(); await assert.rejects(failed, /bad image/);
  assert.equal(loadedCardImage(card), null);
  const retry = loadCardImage(card); await images[1].onload();
  assert.equal(await retry, loadedCardImage(card));
  assert.equal(loadedCardImage(card), images[1]);
});

test('all card faces retain the 2:3 geometry used by hands and WebGL', () => {
  for (const url of new Set(deck().map(cardImage))) {
    const svg = readFileSync(new URL(url), 'utf8');
    assert.match(svg, /<svg\b[^>]*\bwidth="320"[^>]*\bheight="480"[^>]*\bviewBox="0 0 320 480"/);
    assert.doesNotMatch(svg, /<(?:image|text|script|foreignObject)\b/i, url);
  }
});
