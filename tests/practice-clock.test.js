import test from 'node:test';
import assert from 'node:assert/strict';
import { restorePracticeClock, savePractice, readPractice } from '../src/practice-save.js';
import { TURN_MS, TURN_ENTRY_MS } from '../src/game.js';

test('practice restore preserves old 30s budgets and expired zero remainders', () => {
  for (const remainingMs of [30000, 12000, 0]) {
    const saved = {game:{phase:'play',turnDeadline:40000},remainingMs};
    assert.equal(restorePracticeClock(saved,100000), remainingMs);
    assert.equal(saved.game.turnDeadline, 100000 + remainingMs);
  }
});
test('practice missing clocks get shared defaults while old absolute clocks keep their budget', () => {
  const saved = {game:{phase:'play'}};
  assert.equal(restorePracticeClock(saved,1000), TURN_MS + TURN_ENTRY_MS);
  assert.equal(saved.game.turnDeadline,1000 + TURN_MS + TURN_ENTRY_MS);
  const old = {game:{phase:'play',turnDeadline:31000}};
  assert.equal(restorePracticeClock(old,1000),30000);
  const settled = {game:{phase:'roundEnd',turnDeadline:null}};
  assert.equal(restorePracticeClock(settled,1000),null);
});
test('practice pause survives local save and refresh without starting a running deadline', () => {
  const values = new Map(), storage = {getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
  const saved = {me:'p0',game:{phase:'play',players:[{id:'p0'}],turnDeadline:null},paused:true,remainingMs:6500};
  assert.equal(savePractice(storage,saved,1000),true);
  const restored = readPractice(storage,150000);
  assert.equal(restorePracticeClock(restored,150000),6500);
  assert.equal(restored.game.turnDeadline,null);
});
