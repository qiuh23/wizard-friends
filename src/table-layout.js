import { shortName } from './graphemes.js';
import { isDomestic } from './backend-entry.js';
// Search obstacle edges as well as the preferred center. Every returned slot
// fits the viewport and leaves a gap around the DOM seats and played cards.
export function openCardSlot(area, obstacles, width, height, preferred, gap = 8) {
  const xs = [preferred.x, area.left + width / 2, area.right - width / 2];
  const ys = [preferred.y, area.top + height / 2, area.bottom - height / 2];
  for (const r of obstacles) {
    xs.push(r.left - gap - width / 2, r.right + gap + width / 2);
    ys.push(r.top - gap - height / 2, r.bottom + gap + height / 2);
  }
  let best = null, distance = Infinity;
  for (const x of xs) for (const y of ys) {
    const r = { left:x-width/2, right:x+width/2, top:y-height/2, bottom:y+height/2 };
    if (r.left < area.left || r.right > area.right || r.top < area.top || r.bottom > area.bottom) continue;
    if (obstacles.some(o => r.left < o.right+gap && r.right > o.left-gap && r.top < o.bottom+gap && r.bottom > o.top-gap)) continue;
    const score = (x-preferred.x)**2 + (y-preferred.y)**2;
    if (score < distance) { best = { x, y, width, height }; distance = score; }
  }
  return best;
}

// Measure layout, not the animated child rectangle: CSS entry/collection
// transforms must never feed back into the next WebGL destination.
export function playedCardRect(node) {
  const face = node.querySelector('.card');
  const rect = node.getBoundingClientRect();
  return { x: rect.left + face.offsetLeft + face.offsetWidth / 2,
    y: rect.top + face.offsetTop + face.offsetHeight / 2,
    width: face.offsetWidth, height: face.offsetHeight };
}

// This mode is shared by DOM seats, controls and the physical-card renderer.
// A wide phone is still compact when its browser toolbar consumes the height.
export function tableLayoutMode(width, height) {
  return width >= 480 && width > height && height <= 540 ? 'strip' : width < 600 && height <= 700 ? 'portrait-grid' : 'ring';
}

// The expanded hand is an explicit, temporary overlay. Its underlying card
// lane must be recoverable even on a fresh mount or an orientation change.
export function tableOverlayReserve(width,height) {
  const mode=tableLayoutMode(width,height);
  return mode==='strip' ? height<=340 ? 88 : 104 : mode==='portrait-grid' ? 210 : width<600 ? 260 : 280;
}

export function compactCardSlots(area, seats, preferredWidth, emphasis = 1.22) {
  let best;
  for (let columns=1;columns<=seats.length;columns++) {
    const rows=Math.ceil(seats.length/columns), cellWidth=(area.right-area.left)/columns, cellHeight=(area.bottom-area.top)/rows;
    const width=Math.min(preferredWidth,(cellWidth-12)/emphasis,(cellHeight-46)/(1.5*emphasis));
    if(!best || width>best.width)best={columns,rows,width};
  }
  const {columns,rows,width}=best, cellWidth=(area.right-area.left)/columns, cellHeight=(area.bottom-area.top)/rows;
  const height=width*1.5*emphasis+46;
  return {width,slots:new Map(seats.map((seat,index)=>{
    const x=area.left+cellWidth*(index%columns+.5),y=area.top+cellHeight*(Math.floor(index/columns)+.5);
    return [seat.id,{x,y,rect:{left:x-cellWidth/2+4,right:x+cellWidth/2-4,top:y-height/2,bottom:y+height/2}}];
  }))};
}

export function stripCardSlots(area, seats, preferredWidth, emphasis = 1.15) {
  const cell = (area.right - area.left) / seats.length;
  const width = Math.max(24, Math.min(preferredWidth, (cell - 12) / emphasis,
    (area.bottom - area.top - 46) / (1.5 * emphasis)));
  const height = width * 1.5 * emphasis + 46;
  const y = (area.top + area.bottom) / 2 + 3;
  return { width, slots: new Map(seats.map((seat, index) => {
    const x = area.left + cell * (index + .5);
    return [seat.id, { x, y, rect: { left:x-cell/2+4, right:x+cell/2-4,
      top:y-height/2, bottom:y+height/2 } }];
  })) };
}

// A trick belongs in the middle of the felt. Reserve the entire table's seats
// before the first play, so neither play order nor a new leader moves a card.
// Short landscape uses a clockwise row; elsewhere the viewer sits at the foot
// of a small, readable circle. Opposite cards still face the local viewer.
export function tablePlaySlots(area, seats, preferredWidth, strip = false, obstacles = []) {
  const rings = {
    3: [[0, .52], [-.58, -.48], [.58, -.48]],
    4: [[0, .52], [-1, -.52], [0, -.52], [1, -.52]],
    5: [[0, .52], [-1, .52], [-.55, -.52], [.55, -.52], [1, .52]],
    6: [[0, .52], [-1, .52], [-1, -.52], [0, -.52], [1, -.52], [1, .52]],
  };
  const positions = strip ? seats.map((_, i) => [i - (seats.length - 1) / 2, 0]) : rings[seats.length];
  if (!positions || area.bottom <= area.top || area.right <= area.left) return null;
  const xRange = Math.max(...positions.map(p => p[0])) - Math.min(...positions.map(p => p[0]));
  const yRange = Math.max(...positions.map(p => p[1])) - Math.min(...positions.map(p => p[1]));
  // Perspective makes the outer landscape faces slightly wider at their near
  // edge. Leave air for that trapezoid, including the leading card's gold rim.
  const pitchX = strip ? 1.30 : 1.24;
  const gapX = strip ? area.right-area.left > 600 ? 16 : area.right-area.left > 440 ? 12 : 8 : 12;
  const maxWidth = Math.min(preferredWidth, (area.right - area.left - gapX * xRange) / (1.14 + pitchX * xRange),
    (area.bottom - area.top - 34 - 40 * yRange) / (1.5 + 1.62 * yRange));
  const center = { x:(area.left + area.right) / 2, y:(area.top + area.bottom) / 2 };
  for (let width = Math.floor(maxWidth); width >= 28; width -= 2) {
    const slotWidth = width * 1.14, height = width * 1.5 + 34;
    for (const dy of [0, -12, 12, -24, 24]) {
      const slots = new Map(seats.map((seat, index) => {
        const [px, py] = positions[index];
        const x = center.x + px * (width * pitchX + gapX), y = center.y + dy + py * (width * 1.62 + 40);
        return [seat.id, { x, y, angle: [ -2, 3, -3, 2, -2, 3 ][index], rect: { left:x-slotWidth/2, right:x+slotWidth/2, top:y-height/2, bottom:y+height/2 } }];
      }));
      const boxes = [...slots.values()].map(slot => slot.rect);
      if (boxes.every((r, i) => r.left >= area.left && r.right <= area.right && r.top >= area.top && r.bottom <= area.bottom &&
        !obstacles.some(o => intersects(r, o)) && !boxes.slice(i + 1).some(o => intersects(r, o)))) return { width, slots };
    }
  }
  return null;
}

// Reserve the final trick before its first card: a small trick does not grow
// and then jump when the remaining players act. Search the real free rectangles
// instead of imposing a phone-wide 62/86px cap or a permanent left-side gutter.
export function tableLayoutFits(layout, area, obstacles = []) {
  return !!layout && [...layout.slots.values()].every(({rect:r}) =>
    r.left >= area.left && r.right <= area.right && r.top >= area.top && r.bottom <= area.bottom &&
    !obstacles.some(o => intersects(r,o)));
}

export function availableTableRegions(area, obstacles = [], gap = 6) {
  let regions = [area];
  for (const o of obstacles) {
    const next = [];
    for (const r of regions) {
      if (!intersects(r,o,gap)) { next.push(r); continue; }
      for (const candidate of [
        {...r,right:Math.min(r.right,o.left-gap)}, {...r,left:Math.max(r.left,o.right+gap)},
        {...r,bottom:Math.min(r.bottom,o.top-gap)}, {...r,top:Math.max(r.top,o.bottom+gap)},
      ]) if (candidate.right-candidate.left >= 40 && candidate.bottom-candidate.top >= 70) next.push(candidate);
    }
    regions = next.filter((r,i) => !next.some((other,j) => j!==i &&
      other.left<=r.left && other.right>=r.right && other.top<=r.top && other.bottom>=r.bottom &&
      (j<i || other.left<r.left || other.right>r.right || other.top<r.top || other.bottom>r.bottom)));
  }
  return regions;
}

// Full CSS-projected corners, including the leader rim and 3° table turn.
// Keep two text rows below the face. World cards are separately checked against
// these same slots by the offline Three.js projection regression.
export function playedCardFootprint(width) {
  const pitch=32*Math.PI/180,scale=1.025;
  let extentX=0,maxY=0;
  for(const angle of [-3,0,3].map(n=>n*Math.PI/180))for(const x of [-width/2,width/2])for(const y of [-width*.75,width*.75]) {
    const rx=(x*Math.cos(angle)-y*Math.sin(angle))*scale,ry=(x*Math.sin(angle)+y*Math.cos(angle))*scale;
    const perspective=900/(900-ry*Math.sin(pitch));
    extentX=Math.max(extentX,Math.abs(rx*perspective));
    maxY=Math.max(maxY,ry*Math.cos(pitch)*perspective);
  }
  return {slotWidth:Math.max(40,Math.ceil(extentX*2)+4),slotHeight:Math.ceil(width*.67+4+maxY+32)};
}

export function adaptiveTablePlaySlots(area, seats, obstacles = [], maximum = Infinity) {
  if (seats.length < 3 || seats.length > 6 || area.bottom <= area.top || area.right <= area.left) return null;
  let best = null;
  for (const region of availableTableRegions(area,obstacles)) {
    const availableWidth=region.right-region.left, availableHeight=region.bottom-region.top;
    for (let columns=1; columns<=seats.length; columns++) {
      const rows=Math.ceil(seats.length/columns), gap=6;
      let low=0,high=Math.floor(Math.min(maximum,availableWidth,availableHeight));
      while(low<high) {
        const mid=Math.ceil((low+high)/2),size=playedCardFootprint(mid);
        if(columns*size.slotWidth+gap*(columns-1)<=availableWidth && rows*size.slotHeight+gap*(rows-1)<=availableHeight)low=mid;
        else high=mid-1;
      }
      const width=low;
      if (width<28 || (best && width<=best.width)) continue;
      const {slotWidth,slotHeight}=playedCardFootprint(width);
      const positions=[];
      for (let row=0;row<rows;row++) {
        const rowCount=Math.min(columns,seats.length-row*columns);
        for(let column=0;column<rowCount;column++) positions.push({
          x:(column-(rowCount-1)/2)*(slotWidth+gap),
          y:(row-(rows-1)/2)*(slotHeight+gap),
        });
      }
      // Keep clockwise ownership, with the viewer at the foot of the table.
      const angle=p=>(Math.atan2(-p.x,p.y)+Math.PI*2)%(Math.PI*2);
      positions.sort((a,b)=>angle(a)-angle(b));
      const center={x:(region.left+region.right)/2,y:(region.top+region.bottom)/2};
      const slots=new Map(seats.map((seat,index)=>{
        const p=positions[index],x=center.x+p.x,y=center.y+p.y;
        return [seat.id,{x,y,angle:[-2,3,-3,2,-2,3][index],rect:{left:x-slotWidth/2,right:x+slotWidth/2,top:y-slotHeight/2,bottom:y+slotHeight/2}}];
      }));
      const candidate={width,slotWidth,slotHeight,slots};
      if(tableLayoutFits(candidate,area,obstacles))best=candidate;
    }
  }
  return best;
}

// Include a seat number so identical initials and truncated long names remain
// unambiguous, even when the table has only room for a short owner label.
export function shortSeatName(name, seat, self = false) {
  const short = isDomestic() ? name : /^牌友\d+$/.test(name) ? name : shortName(name);
  return `${seat + 1} ${self ? '你' : short}`;
}

const intersects = (a, b, gap = 4) => a.left < b.right + gap && a.right > b.left - gap && a.top < b.bottom + gap && a.bottom > b.top - gap;

// Reserve every player's destination, including seats that have not played.
// Keep each face in its owner's angular sector around the trump. Empty felt
// in a different player's sector is not a valid destination.
export function playedCardSlots(area, seats, center, obstacles, preferredWidth, emphasis = 1, labelSpace = 20) {
  const directions = seats.map(seat=>{
    const length=Math.hypot(seat.x-center.x,seat.y-center.y)||1;
    return {id:seat.id,x:(seat.x-center.x)/length,y:(seat.y-center.y)/length};
  });
  for (const width of [...new Set([1,.92,.84,.76,.68,.6].map(scale => Math.max(36, Math.round(preferredWidth * scale))).concat(36))]) {
    const slotWidth = Math.max(56, width * emphasis + (labelSpace > 20 ? 6 : 0)), height = width * 1.5 * emphasis + labelSpace;
    const rectAt = (x,y) => ({ left:x-slotWidth/2, right:x+slotWidth/2, top:y-height/2, bottom:y+height/2 });
    const candidates = seats.map(seat => {
      const dx = center.x-seat.x, dy = center.y-seat.y, length2 = Math.max(1,dx*dx+dy*dy);
      const preferred = { x:seat.x+dx*.36, y:seat.y+dy*.36 };
      if (seat.self) preferred.y = Math.max(preferred.y,center.y+height*.35);
      const xs = [preferred.x], ys = [preferred.y];
      for(const offset of [-.7,-.6,-.5,-.3,.3,.5,.6,.7]){xs.push(preferred.x+slotWidth*offset);ys.push(preferred.y+slotWidth*offset);}
      for (const t of [.32,.4,.5,.6,.7,.8]) { xs.push(seat.x+dx*t); ys.push(seat.y+dy*t); }
      for (const r of obstacles) { xs.push(r.left-4-slotWidth/2,r.right+4+slotWidth/2); ys.push(r.top-4-height/2,r.bottom+4+height/2); }
      const options = [];
      for (const x of new Set(xs)) for (const y of new Set(ys)) {
        const t = ((x-seat.x)*dx+(y-seat.y)*dy)/length2;
        const cross = ((x-seat.x)*dy-(y-seat.y)*dx)**2/length2;
        if (t < .12 || t > (seat.self ? 1.35 : 1) || cross > (slotWidth*(seat.self ? 1.5 : .7))**2) continue;
        if ((x-center.x)**2+(y-center.y)**2 > length2*.85) continue;
        if (seat.self && y < center.y+height*.22) continue;
        const face={x:x-center.x,y:y-10-center.y};
        const owner=directions.find(direction=>direction.id===seat.id);
        const alignment=face.x*owner.x+face.y*owner.y;
        if (directions.some(other=>other.id!==seat.id&&face.x*other.x+face.y*other.y>alignment-.5)) continue;
        const rect = rectAt(x,y);
        if (rect.left < area.left || rect.right > area.right || rect.top < area.top || rect.bottom > area.bottom || obstacles.some(o => intersects(rect,o))) continue;
        options.push({ x,y,rect,score:(x-preferred.x)**2+(y-preferred.y)**2+cross*4 });
      }
      options.sort((a,b)=>a.score-b.score);
      return { id:seat.id, options:options.slice(0,100) };
    }).sort((a,b)=>a.options.length-b.options.length);
    const chosen = new Map(); let attempts = 0;
    function place() {
      if (chosen.size === candidates.length) return true;
      if (++attempts > 15000) return false;
      // Choose the most constrained remaining seat after each placement;
      // otherwise many nearly identical top-seat options starve a lower seat.
      const available = candidates.filter(seat=>!chosen.has(seat.id)).map(seat=>({id:seat.id,
        options:seat.options.filter(candidate=>![...chosen.values()].some(other=>intersects(candidate.rect,other.rect)))
      })).sort((a,b)=>a.options.length-b.options.length);
      const { id, options } = available[0];
      for (const candidate of options) {
        chosen.set(id,candidate);
        if (place()) return true;
        chosen.delete(id);
      }
      return false;
    }
    if (place()) {
      // A feasible first assignment may force a later player too far inward.
      // Improve neighboring pairs together so one close card can make room
      // for the other, keeping both recognizably near their own avatars.
      for (let pass=0;pass<2;pass++) for (let i=0;i<candidates.length;i++) for (let j=i+1;j<candidates.length;j++) {
        const a=candidates[i],b=candidates[j],others=[...chosen].filter(([id])=>id!==a.id&&id!==b.id).map(([,slot])=>slot);
        const available=seat=>seat.options.filter(slot=>!others.some(other=>intersects(slot.rect,other.rect))).slice(0,30);
        let best=chosen.get(a.id).score+chosen.get(b.id).score;
        for (const first of available(a)) for (const second of available(b)) {
          const score=first.score+second.score;
          if (score>=best || intersects(first.rect,second.rect)) continue;
          best=score;chosen.set(a.id,first);chosen.set(b.id,second);
        }
      }
      return { width, slots:chosen };
    }
  }
  return null;
}

export function playedCardLink(source, sourceRect, targetRect, gap=4) {
  const dx=(targetRect.left+targetRect.right)/2-source.x,dy=(targetRect.top+targetRect.bottom)/2-source.y;
  const length=Math.hypot(dx,dy);if(!length)return null;
  const exit=Math.min(dx>0?(sourceRect.right-source.x)/dx:dx<0?(sourceRect.left-source.x)/dx:Infinity,
    dy>0?(sourceRect.bottom-source.y)/dy:dy<0?(sourceRect.top-source.y)/dy:Infinity)+gap/length;
  const enter=Math.max(dx>0?(targetRect.left-source.x)/dx:dx<0?(targetRect.right-source.x)/dx:-Infinity,
    dy>0?(targetRect.top-source.y)/dy:dy<0?(targetRect.bottom-source.y)/dy:-Infinity)-gap/length;
  return enter>exit?{x1:source.x+dx*exit,y1:source.y+dy*exit,x2:source.x+dx*enter,y2:source.y+dy*enter}:null;
}
