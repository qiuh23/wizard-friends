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

// Include a seat number so identical initials and truncated long names remain
// unambiguous, even when the table has only room for a short owner label.
export function shortSeatName(name, seat, self = false) {
  const short = /^牌友\d+$/.test(name) ? name : [...name].slice(0, 2).join('');
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
