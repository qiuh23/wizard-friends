import { leadSuit, SUIT_NAMES } from './game.js';

export function followSuitHint(state, me) {
  if (state.options?.deckMode === 'mono') return '单色牌库不跟花色，可出任意牌';
  const suit = leadSuit(state.trick ?? [], state.options?.deckMode);
  if (!suit) return '本墩可自由出牌';
  const color = `${SUIT_NAMES[suit].split(' · ')[0]}色`;
  const player = state.players[state.turn];
  if (player?.id === me && player.hand && !player.hand.some(c => c.kind === 'number' && c.suit === suit)) {
    return `你没有${color}，可出任意牌`;
  }
  return `须跟${color}；W / J 随时可出`;
}

// Presentation order is relative to the viewer; engine seat indices never change.
export function relativeSeat(index, self, count) { return (index - Math.max(0, self) + count) % count; }
export function seatPosition(index, self, count, radius = 1) {
  const seat = relativeSeat(index, self, count), angle = seat * Math.PI * 2 / count;
  // Increasing engine seats run clockwise from the viewer at the bottom.
  return { seat, x: 50 - Math.sin(angle) * 42 * radius, y: 51 + Math.cos(angle) * 39 * radius };
}
export function landscapeSeatPosition(index, self, count) {
  const seat = relativeSeat(index, self, count);
  const ring = {
    3: [[14,100],[18,27],[82,27]],
    4: [[14,100],[6,76],[50,-2],[94,76]],
    5: [[14,100],[6,76],[32,9],[68,9],[94,76]],
    6: [[14,100],[6,76],[23,9],[50,-2],[77,9],[94,76]],
  }[count];
  return { seat, x: ring[seat][0], y: ring[seat][1] };
}
export function desktopPlayedPosition(index, self, count, short = false) {
  const seat = relativeSeat(index, self, count);
  if (short) return { seat, x: count === 3 ? 35 + seat * 15 : 24 + seat * 52 / Math.max(1, count - 1), y: 50 };
  const ring = {
    3: [[50,78],[32,22],[68,22]],
    4: [[50,78],[30,50],[50,22],[70,50]],
    5: [[50,78],[30,78],[30,22],[70,22],[70,78]],
    6: [[50,78],[30,78],[30,22],[50,22],[70,22],[70,78]],
  }[count];
  return { seat, x: ring[seat][0], y: ring[seat][1] };
}
export function targetStatus(player, settled = false) {
  if (!Number.isInteger(player?.bid)) return { text: '等待预估', value: '—', state: 'unknown' };
  const gap = player.bid - player.won;
  return { text: gap > 0 ? '还差' : gap < 0 ? '超出' : settled ? '本轮成功' : '暂时达标', value: Math.abs(gap), state: gap === 0 ? (settled ? 'success' : 'matched') : 'pending' };
}
export function playBlockedReason(state, me, card) {
  if (state.lifecycle?.paused) return '房主已暂停，恢复后可操作';
  if (state.lifecycle?.continuationVote) return '正在进行到期续赛投票';
  if (state.phase !== 'play') return state.phase === 'bid' ? '请先完成本轮预估' : '当前不是出牌阶段';
  if (state.players[state.turn]?.id !== me) return '尚未轮到你，可先查看手牌';
  if (!state.legal?.includes(card.id)) {
    const suit = leadSuit(state.trick ?? [], state.options?.deckMode);
    return suit ? `手中有${SUIT_NAMES[suit].split(' · ')[0]}色牌，必须跟色；W / J 随时可出` : '这张牌已不可出，请重新选择';
  }
  return '';
}
export function sortCards(cards, mode = 'suit') {
  const suitOrder = ['blue', 'red', 'green', 'yellow'];
  const strength = c => c.kind === 'wizard' ? 101 : c.kind === 'jester' ? -1 : c.rank;
  return [...cards].sort((a, b) => mode === 'rank' ? strength(a) - strength(b) :
    (suitOrder.indexOf(a.suit) - suitOrder.indexOf(b.suit)) || strength(a) - strength(b));
}
export function isSwipe(start, end, threshold = 10) { return Math.hypot(end.x - start.x, end.y - start.y) > threshold; }

// Vanilla adaptation of the shallow fan geometry in Card Dealer. A readable
// corner stays exposed at 15–20 cards; small hands use larger faces and air.
export function desktopFan(count, width, inspected = -1, selected = -1, compact = false) {
  const cardWidth = compact ? count<=5 ? 48 : 44 : count <= 5 ? 92 : count <= 15 ? 82 : 74;
  const cardHeight = cardWidth * 1.5, edge = 20;
  const room = Math.max(0,width - cardWidth - edge * 2);
  const step = count > 1 ? Math.min(count <= 5 ? 78 : 54,room/(count-1)) : 0;
  return {cardWidth,cardHeight,step,poses:Array.from({length:count},(_,i)=>{
    const offset=i-(count-1)/2,reach=count>1?offset/Math.max(1,(count-1)/2):0;
    return {x:width/2-cardWidth/2+offset*step,y:(compact?4:26)+reach*reach*(compact?3:8),
      angle:reach*Math.min(compact?6:12,Math.max(0,count-1)*1.2),
      push:inspected<0 || i===inspected ? 0 : Math.sign(i-inspected)*10,
      lift:i===inspected ? (compact?-8:-19) : i===selected ? (compact?-5:-14) : 0,
      z:i===inspected ? 300 : i===selected ? 250 : 100+i};
  })};
}
export function compactPlayedPosition(index,self,count,width,landscape=false) {
 const seat=relativeSeat(index,self,count),left=width<=380?42:40,right=100-left;
 if(landscape)return {seat,x:count===1?50:34+seat*40/(count-1),y:52};
 const positions=count===3 ? [{x:50,y:86},{x:right,y:45},{x:left,y:45}] : count===4 ? [{x:50,y:88},{x:right,y:60},{x:50,y:30},{x:left,y:60}] : count===5 ? [{x:50,y:89},{x:right,y:64.5},{x:right,y:40},{x:left,y:40},{x:left,y:64.5}] : [{x:left,y:89},{x:right,y:89},{x:right,y:64.5},{x:right,y:40},{x:left,y:40},{x:left,y:64.5}];
 return {seat,...positions[seat],x:100-positions[seat].x};
}
