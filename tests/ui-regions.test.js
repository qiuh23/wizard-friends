import test from 'node:test';
import assert from 'node:assert/strict';
import { tableViewKey } from '../src/ui-regions.js';

test('social snapshots reuse table regions while deadlines and permissions invalidate them', () => {
  const state = { phase:'play', players:[{id:'a',hand:[{id:'c'}]}], legal:['c'],
    lifecycle:{paused:false,collectionAt:3000,remainingMs:1000} };
  const key = tableViewKey(state, ['a',true]);
  assert.equal(tableViewKey({...state,chat:[{text:'hello'}],eventSeq:3,events:[{}],
    publicEvents:[{}],log:['hello'],lifecycle:{...state.lifecycle,remainingMs:800}}, ['a',true]), key);
  for (const patch of [{legal:[]}, {players:[{id:'a',hand:[]}]},
    {lifecycle:{...state.lifecycle,collectionAt:3100}}, {turnDeadline:5000}]) {
    assert.notEqual(tableViewKey({...state,...patch}, ['a',true]), key);
  }
  assert.notEqual(tableViewKey(state, ['a',false]), key);
});

test('paused remaining time is retained as a presentation input', () => {
  const state = {lifecycle:{paused:true,collectionRemainingMs:500}};
  assert.notEqual(tableViewKey(state, []), tableViewKey({lifecycle:{paused:true,collectionRemainingMs:400}}, []));
});
