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
