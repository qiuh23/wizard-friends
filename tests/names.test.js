import test from 'node:test';
import assert from 'node:assert/strict';
import { BOT_NAMES, validateName, uniqueBotName, resolveName } from '../src/player-names.js';

test('names trim and normalize display while preserving case and full-width characters', () => {
  assert.equal(validateName('  Alice  '), 'Alice');
  assert.equal(validateName('Ａｌｉｃｅ'), 'Ａｌｉｃｅ');
  assert.equal(validateName('Cafe\u0301'), 'Café');
  assert.equal(validateName('巫师'.repeat(8)), '巫师'.repeat(8));
  for (const name of ['', '   ', null, undefined, 123, {}, 'a'.repeat(17), '换\n行', '\t昵称',
    '隐\u200b藏', '伪\u202e装', '响\u0007铃', 'a\u0085b', 'a\u2028b']) {
    assert.throws(() => validateName(name), /昵称/);
  }
});

test('manual duplicates compare trimmed NFKC and case-insensitive keys for every occupied seat', () => {
  for (const name of ['Alice', ' alice ', 'ＡＬＩＣＥ']) {
    assert.throws(() => resolveName(name, ['  ALICE  ', '离线旅人', '机器人']), /已被使用/);
  }
  assert.throws(() => resolveName('离线旅人', ['离线旅人']), /已被使用/);
  assert.throws(() => resolveName('机器人', ['机器人']), /已被使用/);
  assert.equal(resolveName('  ALICE  ', ['另一个名字']), 'ALICE');
});

test('bot nicknames are curated short names with distinct avatar initials and no random tails', () => {
  assert.equal(new Set(BOT_NAMES).size, BOT_NAMES.length);
  assert.equal(new Set(BOT_NAMES.map(name => [...name][0])).size, BOT_NAMES.length);
  for (const name of BOT_NAMES) {
    assert.match(name, /^[\u4e00-\u9fff]{2}$/);
    assert.equal(validateName(name), name);
  }
  const samples = [0, 0.01, 0.5, 0.999999];
  for (const sample of samples) {
    assert.ok(BOT_NAMES.includes(uniqueBotName([], () => sample)));
  }
});

test('a constant random source picks directly from unused candidates without retries', () => {
  let calls = 0;
  const random = () => { calls++; return 0; };
  const remaining = BOT_NAMES.at(-1);
  assert.equal(uniqueBotName(BOT_NAMES.slice(0, -1).map(name => ` ${name} `), random), remaining);
  assert.equal(calls, 1);
});

test('bot selection prefers distinct initials but still uses available names before numbering', () => {
  const name = uniqueBotName(['小王', '阿乐'], () => 0);
  assert.ok(!['小', '阿'].includes([...name][0]));
  assert.equal(uniqueBotName(BOT_NAMES.map(name => `${[...name][0]}客`), () => 0), BOT_NAMES[0]);
});

test('an exhausted pool uses bounded simple numbering with the same normalized duplicate keys', () => {
  const name = uniqueBotName([...BOT_NAMES, '牌友２', ' 牌友3 '], () => { throw Error('no random retry'); });
  assert.equal(name, '牌友4');
  assert.equal(validateName(name), name);
});

test('repeated additions remain unique and removed names may be reused', () => {
  const names = [];
  for (let i = 0; i < 100; i++) names.push(uniqueBotName(names, () => 0));
  assert.equal(new Set(names).size, 100);
  const removed = names.splice(0, 1)[0];
  assert.equal(uniqueBotName(names, () => 0), removed);
});

test('only bots receive generated names; human names must be supplied and never silently change', () => {
  const occupied = [BOT_NAMES[0], 'Alice'];
  for (const automatic of [false, true]) {
    for (const name of ['', '   ', null, undefined]) {
      assert.throws(() => resolveName(name, occupied, { automatic }), /昵称/);
    }
    assert.throws(() => resolveName('ＡＬＩＣＥ', occupied, { automatic }), /已被使用/);
    assert.equal(resolveName('  老名字-9yce  ', occupied, { automatic }), '老名字-9yce');
  }
  for (const [name, automatic] of [['', false], ['机器人', true]]) {
    const resolved = resolveName(name, occupied, { bot: true, automatic });
    assert.ok(BOT_NAMES.includes(resolved));
    assert.ok(!occupied.includes(resolved));
  }
  assert.equal(resolveName('旧机器人-9yce', occupied, { bot: true }), '旧机器人-9yce');
});
