import test from 'node:test';
import assert from 'node:assert/strict';
import { openCardSlot, playedCardSlots } from '../src/table-layout.js';

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

test('played cards reserve distinct destinations between every avatar and the trump', () => {
  const area={left:8,right:836,top:8,bottom:382};
  const seats=[{id:'self',x:30,y:330},{id:'left',x:152,y:100},{id:'right',x:692,y:100}];
  const center={x:422,y:220};
  const obstacles=[{left:110,right:195,top:77,bottom:144},{left:650,right:734,top:77,bottom:144},
    {left:384,right:460,top:163,bottom:277},{left:8,right:160,top:310,bottom:382}];
  const layout=playedCardSlots(area,seats,center,obstacles,70);
  assert.equal(layout.width,70);
  assert.equal(layout.slots.size,seats.length);
  const overlap=(a,b)=>a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;
  const reserved=[];
  for(const seat of seats) {
    const slot=layout.slots.get(seat.id),dx=center.x-seat.x,dy=center.y-seat.y;
    const t=((slot.x-seat.x)*dx+(slot.y-seat.y)*dy)/(dx*dx+dy*dy);
    assert.ok(t>0&&t<1);
    assert.ok(slot.rect.left>=area.left&&slot.rect.right<=area.right&&slot.rect.top>=area.top&&slot.rect.bottom<=area.bottom);
    for(const obstacle of [...obstacles,...reserved])assert.ok(!overlap(slot.rect,obstacle));
    reserved.push(slot.rect);
  }
});

test('played-card sizing shrinks to fit and reports a completely obstructed playfield', () => {
  const seats=[{id:'left',x:0,y:100},{id:'right',x:300,y:100}],center={x:150,y:100};
  const area={left:10,right:290,top:30,bottom:170};
  const layout=playedCardSlots(area,seats,center,[],118);
  assert.ok(layout&&layout.width<118&&layout.width>=40);
  assert.equal(playedCardSlots(area,seats,center,[area],118),null);
});

test('six narrow-landscape seats keep the viewer below and beside the unobstructed trump', () => {
  const center={x:333.5,y:212.265625},area={left:8,right:659,top:8,bottom:367};
  const seats=[{id:'p0',self:true,x:30,y:341},{id:'p1',x:63,y:165.328125},
    {id:'p2',x:153.40625,y:75.546875},{id:'p3',x:333.5,y:47.421875},
    {id:'p4',x:513.578125,y:75.546875},{id:'p5',x:604,y:165.328125}];
  const obstacles=seats.slice(1).map(s=>({left:s.x-36,right:s.x+36,top:s.y-22,bottom:s.y+47}));
  const trump={left:295.5,right:371.5,top:155.265625,bottom:269.265625};
  obstacles.push(trump,{left:8,right:153,top:319,bottom:363},{left:168,right:659,top:285.828125,bottom:359},
    {left:513,right:657,top:8,bottom:52},{left:12,right:141.125,top:10,bottom:29});
  const layout=playedCardSlots(area,seats,center,obstacles,68);
  assert.ok(layout);assert.equal(layout.slots.size,6);
  const own=layout.slots.get('p0');
  assert.ok(own.y>center.y);
  assert.ok(own.rect.right<trump.left||own.rect.left>trump.right||own.rect.top>trump.bottom);
  for(const slot of layout.slots.values())assert.ok(slot.rect.right<=trump.left||slot.rect.left>=trump.right||slot.rect.bottom<=trump.top||slot.rect.top>=trump.bottom);
});
