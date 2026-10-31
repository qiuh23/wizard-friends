import test from 'node:test';
import assert from 'node:assert/strict';
import { openCardSlot, playedCardSlots, playedCardLink, tableLayoutMode, stripCardSlots, compactCardSlots, shortSeatName } from '../src/table-layout.js';

test('container height selects the same compact mode on either side of 850px', () => {
  for (const [width,height] of [[568,320],[667,375],[844,390],[932,430],[844,300]]) assert.equal(tableLayoutMode(width,height),'strip');
  for (const [width,height] of [[1440,900],[390,844]]) assert.equal(tableLayoutMode(width,height),'ring');
  assert.equal(tableLayoutMode(360,640),'portrait-grid');
});

test('a short portrait chooses columns from available face size and reserves all six owners', () => {
  const area={left:10,right:350,top:154,bottom:430};
  const seats=Array.from({length:6},(_,i)=>({id:`p${i}`}));
  const layout=compactCardSlots(area,seats,62);
  assert.ok(layout.width>=50);
  for(const slot of layout.slots.values())assert.ok(slot.rect.top>=area.top&&slot.rect.bottom<=area.bottom);
});

test('short landscape reserves six fixed slots including owner and maximum emphasis before any play', () => {
  const area={left:10,right:834,top:82,bottom:212};
  const seats=Array.from({length:6},(_,i)=>({id:`p${i}`}));
  const layout=stripCardSlots(area,seats,56);
  assert.ok(layout.width>=48);
  for (const [i,seat] of seats.entries()) {
    const slot=layout.slots.get(seat.id);
    assert.ok(slot.rect.top>=area.top&&slot.rect.bottom<=area.bottom+3);
    assert.ok(slot.rect.left>=area.left&&slot.rect.right<=area.right);
    assert.ok(slot.rect.right-slot.rect.left>layout.width*1.15+6);
    if(i)assert.ok(layout.slots.get(seats[i-1].id).rect.right<slot.rect.left);
  }
  assert.notEqual(shortSeatName('青山学徒-长昵称',1),shortSeatName('青山旅人-长昵称',2));
  assert.equal(shortSeatName('某某',0,true),'1 你');
});

test('short owner labels keep everyday nicknames and the complete fallback number', () => {
  assert.equal(shortSeatName('小林', 1), '2 小林');
  assert.equal(shortSeatName('牌友2', 2), '3 牌友2');
  assert.equal(shortSeatName('牌友123', 3), '4 牌友123');
  assert.notEqual(shortSeatName('牌友2', 1), shortSeatName('牌友3', 1));
});

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

test('six narrow-landscape cards cannot occupy another avatar sector even when that space is empty', () => {
  const center={x:333.5,y:212.265625},area={left:8,right:659,top:8,bottom:367};
  const seats=[{id:'p0',self:true,x:30,y:341},{id:'p1',x:63,y:165.328125},
    {id:'p2',x:153.40625,y:75.546875},{id:'p3',x:333.5,y:47.421875},
    {id:'p4',x:513.578125,y:75.546875},{id:'p5',x:604,y:165.328125}];
  const obstacles=seats.slice(1).map(s=>({left:s.x-36,right:s.x+36,top:s.y-22,bottom:s.y+47}));
  const trump={left:295.5,right:371.5,top:155.265625,bottom:269.265625};
  obstacles.push(trump,{left:8,right:153,top:319,bottom:363},{left:168,right:659,top:285.828125,bottom:359},
    {left:513,right:657,top:8,bottom:52},{left:12,right:141.125,top:10,bottom:29});
  assert.equal(playedCardSlots(area,seats,center,obstacles,36),null,'the large central trump leaves no honest top-seat slot');
  const smallerTrump={left:center.x-15.2,right:center.x+15.2,top:center.y-22.8,bottom:center.y+22.8};
  obstacles[obstacles.indexOf(trump)]=smallerTrump;
  const layout=playedCardSlots(area,seats,center,obstacles,36);
  assert.ok(layout);assert.equal(layout.slots.size,6);
  const own=layout.slots.get('p0');
  assert.ok(own.y>center.y);
  assert.ok(own.rect.right<smallerTrump.left||own.rect.left>smallerTrump.right||own.rect.top>smallerTrump.bottom);
  for(const seat of seats){
    const slot=layout.slots.get(seat.id),face={x:slot.x-center.x,y:slot.y-10-center.y};
    const alignment=source=>(face.x*(source.x-center.x)+face.y*(source.y-center.y))/Math.hypot(source.x-center.x,source.y-center.y);
    for(const other of seats.filter(other=>other.id!==seat.id))assert.ok(alignment(seat)>alignment(other),'card stays in its own avatar direction');
    assert.ok(slot.rect.right<=smallerTrump.left||slot.rect.left>=smallerTrump.right||slot.rect.bottom<=smallerTrump.top||slot.rect.top>=smallerTrump.bottom);
  }
});

test('ownership links stop before the player and card rectangles and omit a gap too short to draw', () => {
  const source={x:20,y:20},player={left:10,right:30,top:10,bottom:30};
  const link=playedCardLink(source,player,{left:60,right:80,top:10,bottom:30});
  for(const [key,value]of Object.entries({x1:34,y1:20,x2:56,y2:20}))assert.ok(Math.abs(link[key]-value)<1e-9);
  assert.equal(playedCardLink(source,player,{left:34,right:54,top:10,bottom:30}),null);
});

test('a leading card can grow on a small portrait table without changing ownership or overlapping seats', () => {
  const seats=[{id:'p1',x:44,y:315.117},{id:'p2',x:91.125,y:184.742},
    {id:'p3',x:268.859,y:184.742},{id:'p4',x:316,y:315.117},{id:'p0',self:true,x:32,y:470}];
  const center={x:180,y:325.805};
  const obstacles=seats.filter(seat=>!seat.self).map(seat=>({left:seat.x-36,right:seat.x+36,top:seat.y-22,bottom:seat.y+46.797}));
  obstacles.push({left:10,right:350,top:448,bottom:492},{left:117,right:243,top:516,bottom:632},
    {left:206,right:350,top:8,bottom:52},{left:14,right:148,top:12,bottom:31},
    {left:161.203,right:198.797,top:297.609,bottom:354});
  const layout=playedCardSlots({left:8,right:352,top:8,bottom:632},seats,center,obstacles,36,1.06);
  assert.ok(layout); assert.equal(layout.slots.size,5);
  for(const seat of seats){
    const slot=layout.slots.get(seat.id),face={x:slot.x-center.x,y:slot.y-10-center.y};
    const alignment=source=>(face.x*(source.x-center.x)+face.y*(source.y-center.y))/Math.hypot(source.x-center.x,source.y-center.y);
    for(const other of seats.filter(other=>other.id!==seat.id))assert.ok(alignment(seat)>alignment(other));
    for(const rect of [...obstacles,...[...layout.slots].filter(([id])=>id!==seat.id).map(([,other])=>other.rect)]){
      assert.ok(slot.rect.right<=rect.left||slot.rect.left>=rect.right||slot.rect.bottom<=rect.top||slot.rect.top>=rect.bottom);
    }
  }
});
