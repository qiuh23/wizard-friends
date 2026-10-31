import test from 'node:test';
import assert from 'node:assert/strict';
import { turnStatus } from '../src/turn-status.js';
import { tableViewKey } from '../src/ui-regions.js';

const state = life => ({ phase: 'play', turn: 0, players: [{id:'p0',name:'甲'}], turnDeadline: 46000, lifecycle: life });
test('normal, urgent, paused and disconnected clocks show the correct public state', () => {
  assert.equal(turnStatus(state({}), {now:1000}).text, '45 秒');
  assert.equal(turnStatus(state({}), {now:36000}).urgent, true);
  assert.equal(turnStatus(state({paused:true,remainingMs:0}), {now:1000}).text, '暂停 · 0 秒');
  assert.equal(turnStatus(state({}), {now:1000,connected:false}).text, '连接恢复中');
  assert.equal(turnStatus({...state({}),turnDeadline:null}, {now:1000}).text, '同步中');
});
test('disconnect wait is named accessibly and counts down in server time', () => {
  const waiting = state({reconnecting:true,reconnectPlayerId:'p0',reconnectUntil:21000,reconnectRemainingMs:20000});
  assert.deepEqual(turnStatus(waiting, {now:1000}), {text:'断线等待 20 秒',label:'甲 断线，等待重连 20 秒',urgent:false});
  assert.equal(turnStatus(waiting, {now:12000}).text, '断线等待 9 秒');
  const updated = structuredClone(waiting); updated.lifecycle.reconnectRemainingMs = 9000;
  assert.equal(tableViewKey(waiting, 'room'), tableViewKey(updated, 'room'));
  updated.lifecycle.reconnecting = false; updated.turnDeadline = 55000;
  assert.notEqual(tableViewKey(waiting, 'room'), tableViewKey(updated, 'room'));
});
