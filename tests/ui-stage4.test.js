import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import postcss from 'postcss';
const files = fs.readdirSync(new URL('../src/', import.meta.url)).filter(f => f.endsWith('.css')).map(f => 'src/' + f).concat('src/ui/theme.css');
const roots = new Map(files.map(f => [f, postcss.parse(fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8'))]));
const theme = roots.get('src/ui/theme.css'), tokens = new Map();
theme.walkDecls(d => {
    if (d.parent.selector === ':root')
        tokens.set(d.prop, d.value);
});
const art = JSON.parse(fs.readFileSync(new URL('fixtures/stage4-art-preservation.json', import.meta.url), 'utf8'));
function context(n) {
    const a = [];
    for (let p = n.parent; p; p = p.parent) {
        if (p.type === 'rule')
            a.unshift(p.selector);
        if (p.type === 'atrule')
            a.unshift('@' + p.name + ' ' + p.params);
    }
    return a.join(' | ');
}
function originalValue(v) {
    const m = /^var\((--(?:effect-|glow-candle)[^)]*)\)$/.exec(v);
    return m ? tokens.get(m[1]) : v;
}
const lookup = new Map();
for (const [file, ast] of roots) {
    const ord = new Map();
    ast.walkDecls(d => {
        const ctx = context(d), key = ctx + '|' + d.prop, nth = ord.get(key) || 0;
        ord.set(key, nth + 1);
        lookup.set([file, ctx, d.prop, nth].join('\n'), d.value);
    });
}
const read = (file, selector, property) => {
    let result;
    roots.get(file).walkRules(r => {
        if (r.selector === selector)
            r.walkDecls(property, d => result = d.value);
    });
    return result;
};
test('stage4 preserves stage3 artwork colors, gradients and exact effect shadows', () => {
    assert.equal(art.length, 180);
    for (const row of art) {
        const current = lookup.get([row.file, row.context, row.property, row.nth].join('\n'));
        assert.equal(originalValue(current), row.value, JSON.stringify(row));
    }
});
test('semantic UI roles have one canonical definition, independent of raw color count', () => {
    for (const [name, value] of Object.entries({
        '--ui-text': '#f7f4ec', '--ui-text-muted': '#b9c4bb', '--gold': '#e6c486', '--gold-ink': '#221b10', '--ui-focus': '#fff4b8', '--table-panel': 'var(--ui-surface)', '--table-brass': 'var(--gold)', '--table-parchment': '#f3ead6'
    }))
        assert.equal(tokens.get(name), value);
    for (const [file, ast] of roots)
        ast.walkDecls(d => {
            if (/^--(?:ui-text|ui-text-muted|ui-surface|ui-control|ui-border|ui-control-border|gold|gold-ink|ui-focus)$/.test(d.prop))
                assert.equal(file + ' ' + d.parent.selector, 'src/ui/theme.css :root');
        });
    assert.equal(read('src/home-menu.css', '.menu-options .menu-choice:hover:not(:disabled)', 'background'), 'var(--ui-control-hover)');
    assert.equal(read('src/home-menu.css', '.menu-options .menu-choice:disabled', 'color'), 'var(--ui-text-muted)');
});
test('real text uses approved nine steps and ordinary weights; drawing glyphs are not text', () => {
    const drawing = /(?:\.sigil\b|\.brand-icon\b|\.table-empty\s*>\s*span\b|\.lobby-settings:after)/;
    for (const n of [11, 12, 13, 14, 16, 18, 20, 24, 32])
        assert.equal(tokens.get(`--font-size-${n}`), `${n}px`);
    for (const [file, ast] of roots)
        ast.walkDecls(d => {
            if (drawing.test(d.parent.selector || '') || d.prop.startsWith('--') || d.value === '0' || d.value === 'inherit')
                return;
            if (d.prop === 'font-size')
                assert.match(d.value, /^var\(--font-size-(?:11|12|13|14|16|18|20|24|32)\)$/, file + ' ' + d.value);
            if (d.prop === 'font' && d.parent.type === 'rule')
                assert.match(d.value, /var\(--font-size-(?:11|12|13|14|16|18|20|24|32)\)/, file + ' ' + d.value);
            if (d.prop === 'font-weight' && /^\d+$/.test(d.value))
                assert.ok([400, 500, 600, 700, 800].includes(+d.value));
        });
});
test('UI shadows are elevations or explicit exact-valued art effects', () => {
    assert.equal(tokens.get('--shadow-1'), '0 2px 8px rgba(0, 0, 0, .18)');
    assert.equal(tokens.get('--shadow-2'), '0 8px 24px rgba(0, 0, 0, .28)');
    assert.equal(tokens.get('--shadow-3'), '0 18px 54px rgba(0, 0, 0, .42)');
    for (const [file, ast] of roots)
        ast.walkDecls('box-shadow', d => assert.match(d.value, /^(?:none|var\(--(?:shadow-|ui-shadow|effect-|glow-candle)[^)]*\))$/, file + ' ' + d.value));
});
test('keyboard focus uses one 2px ring without repurposing gameplay outlines', () => {
    for (const [, ast] of roots)
        ast.walkDecls(d => {
            if (/:focus/.test(d.parent.selector || '') && d.prop === 'outline' && d.value !== 'none')
                assert.equal(d.value, '2px solid var(--ui-focus)');
        });
    assert.equal(read('src/table-play.css', 'body[data-screen="game"][data-table-layout] .table .played-cards .played.winner .card', 'outline'), '2px solid #8eeeff');
});
test('touch controls and hand CSS have 44px floors, choice glyphs keep their original size', () => {
    assert.equal(tokens.get('--ui-touch-size'), '44px');
    assert.equal(read('src/style.css', '.check input', 'width'), '17px');
    assert.equal(read('src/round-summary.css', '.rule-choices input', 'width'), '18px');
    const hand = 'body[data-screen="game"] .hand .card';
    assert.equal(read('src/table-ui.css', hand, 'width'), 'max(var(--ui-touch-size), var(--hand-card-width))');
    assert.equal(read('src/table-ui.css', hand, 'height'), 'calc(max(var(--ui-touch-size), var(--hand-card-width)) * 1.5)');
    let labels = false;
    theme.walkRules(r => {
        if (r.selector.includes('label:has(input[type="radio"])'))
            labels = r.nodes.some(d => d.prop === 'min-height' && d.value === 'var(--ui-touch-size)');
    });
    assert(labels);
});
test('all remaining literal UI color declarations are documented stage3 artwork', () => {
    const protectedKeys = new Set(art.map(row => [row.file, row.context, row.property, row.nth].join('\n')));
    for (const [key, value] of lookup) {
        const [file, ctx, property] = key.split('\n');
        if (property.startsWith('--') || !/^(?:color|background(?:-color)?|border(?:-[\w-]+)?|outline(?:-color)?|text-shadow|scrollbar-color|accent-color|fill|stroke)$/.test(property) || !/#[\da-f]{3,8}\b|rgba?\([^)]*\)|\b(?:white|black)\b/i.test(value) || /gradient\(|url\(/.test(value))
            continue;
        assert(protectedKeys.has(key), `Unclassified literal UI color: ${file} ${ctx} ${property}: ${value}`);
    }
    for (const [, ast] of roots)
        ast.walkDecls('scrollbar-color', d => assert.match(d.value, /^var\(--ui-control-border\) (?:var\(--ui-surface\)|transparent)$/));
    assert.equal(read('src/score-bubbles.css', '.round-score-bubble', 'color'), 'var(--score-plus)');
    assert.equal(read('src/score-bubbles.css', '.round-score-bubble.score-loss', 'color'), 'var(--score-minus)');
    for (const name of ['--effect-cinematic-player-active-6', '--effect-table-ui-own-status-active-49', '--effect-table-polish-effect-43', '--effect-table-polish-effect-44']) {
        assert.match(tokens.get(name), /var\(--gold\)/);
        assert.doesNotMatch(tokens.get(name), /#[\da-f]+/i);
    }
    assert.equal(read('src/style.css', '.card', 'border-radius'), 'var(--radius-sm)');
});
