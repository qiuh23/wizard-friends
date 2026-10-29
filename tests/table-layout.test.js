import test from 'node:test';
import assert from 'node:assert/strict';
import { openCardSlot } from '../src/table-layout.js';

test('trump yields to an opposite seat and never leaves the available table', () => {
  const area = {left:8,right:382,top:64,bottom:410};
  const seats = [{left:158,right:232,top:140,bottom:210},{left:20,right:92,top:275,bottom:345}];
  const slot = openCardSlot(area,seats,74,111,{x:195,y:180});
  assert.ok(slot);
  const rect = {left:slot.x-37,right:slot.x+37,top:slot.y-55.5,bottom:slot.y+55.5};
  assert.ok(rect.left>=area.left && rect.right<=area.right && rect.top>=area.top && rect.bottom<=area.bottom);
  for (const seat of seats) assert.ok(rect.right<=seat.left-8 || rect.left>=seat.right+8 || rect.bottom<=seat.top-8 || rect.top>=seat.bottom+8);
});
test('trump has no physical slot when a foresight panel occupies the available area', () => {
  const area = {left:8,right:382,top:64,bottom:150};
  assert.equal(openCardSlot(area,[area],74,111,{x:195,y:100}),null);
});
