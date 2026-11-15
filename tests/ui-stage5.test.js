import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { buildSync } from 'esbuild';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import postcss from 'postcss';
import { renderTrumpDisplay, TrumpReveal } from '../src/trump-display.js';
import { TRUMP_COLORS } from '../src/trump-style.js';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const css = file => postcss.parse(read(file));
const declarations = (file, selector) => {
  const result = {};
  css(file).walkRules(rule => { if (rule.selector === selector) rule.walkDecls(d => result[d.prop] = d.value); });
  return result;
};
const tokens = declarations('src/ui/theme.css', ':root');

test('stage5 gameplay felt uses the same two material tokens throughout the cascade', () => {
  let backgrounds = 0;
  for (const file of ['style', 'cinematic', 'fullscreen', 'table-ui']) css(`src/${file}.css`).walkRules(rule => {
    if (!['.table', '.has-webgl .table', 'body[data-screen="game"] .table'].includes(rule.selector)) return;
    rule.walkDecls('background', d => {
      assert.equal(d.value, 'radial-gradient(ellipse at center, var(--felt-1), var(--felt-2) 80%)');
      backgrounds++;
    });
  });
  assert.equal(backgrounds, 7);
});

test('fallback props and passive gold glow exist at desktop and mobile sizes, but not with WebGL', () => {
  const selector = 'body[data-screen="game"]:not(.has-webgl) .table-props';
  let found = false;
  css('src/round-summary.css').walkRules(rule => {
    if (rule.selector !== selector) return;
    assert.equal(rule.parent.type, 'root'); found = true;
  });
  assert(found);
  assert.equal(declarations('src/round-summary.css', '.table-props').display, 'none');
  assert.equal(declarations('src/round-summary.css', selector)['pointer-events'], 'none');
  const pool = declarations('src/round-summary.css', selector + ' :is(.prop-candle,.prop-book,.prop-orb)::after');
  assert.equal(pool['pointer-events'], 'none');
  assert.equal(pool['z-index'], '-1');
  assert.match(pool.background, /radial-gradient.*var\(--gold\) 24%/);
  assert.equal(pool['box-shadow'], 'var(--glow-candle)');
  assert.match(tokens['--glow-candle'], /var\(--gold\)/);
  assert.equal(declarations('src/table-clarity.css', 'body[data-screen="game"] .table-props').opacity, '.8');
});

class Element {
  constructor(tag) {
    this.tagName = tag; this.children = []; this.dataset = {}; this.attributes = {};
    this.style = { setProperty(name, value) { this[name] = value; }, removeProperty(name) { delete this[name]; } };
    this.classList = { add: name => { this.className += ' ' + name; } };
  }
  append(...children) { for (const child of children) { child.parent = this; this.children.push(child); } }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); }
  setAttribute(name, value) { this.attributes[name] = value; }
  querySelector(selector) { return this.children.find(child => child.className?.split(' ').includes(selector.slice(1))) || null; }
  addEventListener(name, listener) { this[name + 'Listener'] = listener; }
  showModal() { this.open = true; }
  close() { this.open = false; this.closeListener(); }
  focus() { this.focused = true; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 22, height: 22 }; }
}

test('trump aura follows all four suits and both special cards without changing gameplay suit color', () => {
  const priorDocument = globalThis.document, priorWindow = globalThis.window, priorComputed = globalThis.getComputedStyle;
  globalThis.document = { createElement: tag => new Element(tag), body: new Element('body') };
  globalThis.window = { innerWidth: 390, innerHeight: 844 };
  globalThis.getComputedStyle = () => ({ getPropertyValue: () => '0' });
  try {
    const table = new Element('section');
    const examples = [
      ...Object.entries(TRUMP_COLORS).filter(([suit]) => suit !== 'none').map(([trump, aura]) => ({ trump, reveal: { kind: 'number', suit: trump, rank: 4 }, aura })),
      { trump: null, phase: 'trump', reveal: { kind: 'wizard' }, aura: 'var(--accent)' },
      { trump: 'red', reveal: { kind: 'wizard' }, aura: 'var(--accent)' },
      { trump: null, reveal: { kind: 'jester' }, aura: 'var(--accent)' },
      { trump: null, reveal: null, aura: TRUMP_COLORS.none },
      { trump: null, reveal: null, options: { deckMode: 'mono' }, aura: TRUMP_COLORS.none },
    ];
    for (const example of examples) {
      const state = { phase: 'bid', round: 1, eventSeq: 1, events: [{ type: 'round', round: 1, seq: 1, time: 1000 }], trick: [], ...example };
      const before = JSON.stringify(state);
      renderTrumpDisplay(table, state);
      assert.equal(table.children.length, 1, 'rerenders replace the badge rather than duplicating it');
      const badge = table.children[0], label = badge.children[0];
      assert.equal(badge.style['--trump-aura-color'], example.aura);
      assert.equal(table.style['--trump-color'], TRUMP_COLORS[example.trump || 'none']);
      assert.equal(badge.attributes.role, 'status');
      assert.equal(badge.attributes['aria-live'], 'polite');
      if (example.reveal) {
        label.onclick();
        const dialog = badge.children.at(-1);
        assert.equal(dialog.open, true);
        dialog.children.at(-1).onclick();
        assert.equal(badge.children.length, 1);
        assert.equal(label.focused, true);
        const reveal = new TrumpReveal(() => 1000);
        reveal.sync({ phase: 'lobby', round: 0 }, { initial: true });
        reveal.sync(state, { serverNow: 1000 });
        // The fake badge need not parse its SVG; the reveal root still receives the same aura.
        table.querySelector = selector => selector === '.table-trump' ? label : null;
        reveal.mount(table);
        assert.equal(reveal.root.style['--trump-aura-color'], example.aura);
        reveal.finish();
        delete table.querySelector;
      }
      assert.equal(JSON.stringify(state), before);
    }
  } finally {
    globalThis.document = priorDocument; globalThis.window = priorWindow; globalThis.getComputedStyle = priorComputed;
  }
});

test('trump badge and reveal label combine the requested surface, elevation and suit halo', () => {
  for (const selector of ['body[data-screen="game"] .table .trump-display .table-trump', '.trump-reveal-label']) {
    const style = declarations('src/trump-display.css', selector);
    assert.equal(style.background, 'var(--ui-surface)');
    assert.equal(style.color, 'var(--trump-aura-color)');
    assert.equal(style['box-shadow'], 'var(--effect-trump-halo)');
    assert.equal(style.border, '1px solid var(--trump-aura-color)');
  }
  assert.match(tokens['--effect-trump-halo'], /^var\(--shadow-2\), .*currentColor 35%/);
  // Inspect the actual later CSS imports too, not only the component stylesheet.
  const badge = 'body[data-screen="game"] .table .trump-display .table-trump';
  const cascade = {};
  for (const [, path] of read('src/main.js').matchAll(/import '\.\/([^']+\.css)'/g)) {
    Object.assign(cascade, declarations('src/' + path, badge));
  }
  assert.equal(cascade.background, 'var(--ui-surface)');
  assert.equal(cascade.border, '1px solid var(--trump-aura-color)');
  assert.equal(cascade['box-shadow'], 'var(--effect-trump-halo)');
  assert.equal(cascade.padding, '4px 8px');
});

mkdirSync('.local/component-tests', { recursive: true });
const modulePath = new URL('../.local/component-tests/stage5-settlement.mjs', import.meta.url);
writeFileSync(modulePath, buildSync({ entryPoints: ['src/ui/settlement.tsx'], bundle: true, platform: 'node', format: 'esm', packages: 'external', write: false, jsx: 'automatic' }).outputFiles[0].contents);
const { Settlement } = await import(modulePath.href);
const model = (phase = 'roundEnd', hit = true) => ({
  me: 'p0', isHost: true, spectating: false,
  state: { phase, round: 1, players: [
    { id: 'p0', name: '玩家一', score: 20, online: true },
    { id: 'p1', name: '玩家二', score: 20, online: true },
    { id: 'p2', name: '玩家三', score: -10, online: true },
  ], lastWinner: 0, history: [{ round: 1, result: [
    { id: 'p0', bid: 0, won: hit ? 0 : 1, delta: hit ? 20 : -10, total: 20 },
    { id: 'p1', bid: 0, won: 0, delta: 20, total: 20 },
    { id: 'p2', bid: 1, won: 0, delta: -10, total: -10 },
  ] }] },
});
const render = value => renderToStaticMarkup(createElement(Settlement, { model: value }));

test('round outcomes get subtle hit/miss hooks while tricks and spectators remain neutral', () => {
  assert.match(render(model()), /class="table-result result-hit" role="status" aria-label="第 1 轮结算/);
  assert.match(render(model('roundEnd', false)), /class="table-result result-miss"/);
  assert.match(render(model('trickEnd')), /class="table-result"/);
  assert.match(render({ ...model(), me: 'spectator', spectating: true }), /class="table-result"/);
  for (const [selector, color] of [['body[data-screen="game"] .table-result:is(.result-hit,.result-miss)', '--score-plus'], ['body[data-screen="game"] .table-result.result-miss', '--score-minus']]) {
    const style = declarations('src/immersive-table.css', selector);
    assert.equal(style.background, `color-mix(in srgb, var(${color}) 10%, transparent)`);
  }
  assert.equal(declarations('src/immersive-table.css', 'body[data-screen="game"] .table-result:is(.result-hit,.result-miss)')['border-left'], '3px solid var(--score-plus)');
});

test('final ranking highlights every tied winner without changing ranks, totals, labels or actions', () => {
  const value = model('finished'), before = JSON.stringify(value), html = render(value);
  assert.equal((html.match(/class="final-rank final-rank-first"/g) || []).length, 2);
  assert.equal((html.match(/class="final-rank final-rank-first">1<\/td>/g) || []).length, 2);
  assert.match(html, /class="final-rank">3<\/td>/);
  assert.match(html, /class="final-delta positive">\+20<\/td>/);
  assert.match(html, /class="final-delta negative">-10<\/td>/);
  assert.match(html, /aria-label="最终分数播报，可滚动"/);
  assert.match(html, /id="rematch"/);
  assert.equal(JSON.stringify(value), before);
  value.state.lifecycle = { closeAfterRound: true };
  assert.match(render(value), /id="confirm-results"/);
  value.pendingSettlement = true;
  assert.match(render(value), /disabled=""/);
  value.me = 'spectator'; value.spectating = true;
  assert.doesNotMatch(render(value), /id="confirm-results"/);
});

test('results use 40px rows, quiet stripes, muted non-winner ranks and tokenized signed scores', () => {
  assert.equal(declarations('src/immersive-table.css', 'body[data-screen="game"] .final-results :is(th,td)').height, '40px');
  assert.equal(declarations('src/immersive-table.css', '.final-results tbody tr:nth-child(even)').background, 'var(--score-stripe)');
  assert.equal(tokens['--score-stripe'], 'rgba(255, 255, 255, .03)');
  assert.equal(declarations('src/immersive-table.css', '.final-results .final-rank').color, 'var(--ui-text-muted)');
  const first = declarations('src/immersive-table.css', '.final-results .final-rank-first');
  assert.equal(first.color, 'var(--gold)'); assert.match(first.font, /var\(--font-size-24\).*var\(--font-display\)/);
  assert.equal(tokens['--score-plus'], '#9acbaf'); assert.equal(tokens['--score-minus'], '#e39782');
});

test('home primary has a physical gold edge and secondaries use the shared control surface', () => {
  const primary = declarations('src/home-menu.css', '.menu-options .menu-primary');
  assert.equal(primary.background, 'var(--gold)'); assert.equal(primary.color, 'var(--gold-ink)');
  assert.equal(tokens['--gold-edge'], '#8a6d3b');
  assert.equal(tokens['--effect-home-menu-menu-options-menu-primary-19'], '0 3px 0 var(--gold-edge)');
  assert.equal(declarations('src/home-menu.css', '.menu-options .menu-choice').background, 'var(--ui-control)');
  assert.equal(declarations('src/home-menu.css', '.menu-options .menu-primary:disabled')['box-shadow'], 'none');
});
