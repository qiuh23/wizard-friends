import { QualityHintOnce } from './graphics-quality.js';

// Protect actual cards, seats and all game controls, not just one assumed phone layout.
export const QUALITY_HINT_OBSTACLES = '.player,.played,.hand-section,.own-status,.game-toolbar,.hand-tools,.roundbar,.trump-display,.bid-panel,.bid-options,.foresight-hands,.table-result,.lifecycle-banner,.continuation-panel,.table-menu-panel:not([hidden]),.table-score-panel:not([hidden]),.rules-modal,.chat-panel';
export function qualityHintPosition(width, height, viewport, obstacles) {
  const { left = 0, top = 0, right, bottom } = viewport, gap = 10;
  if (width > right - left - gap * 2 || height > bottom - top - gap * 2) return null;
  const xs = [right - width - gap, left + gap, left + (right - left - width) / 2];
  const ys = [top + 64, top + gap, top + (bottom - top - height) / 2, bottom - height - gap];
  for (const y of ys) for (const x of xs) {
    if (y < top + gap || y + height > bottom - gap) continue;
    if (obstacles.every(r => x + width + gap <= r.left || x - gap >= r.right || y + height + gap <= r.top || y - gap >= r.bottom)) return { x, y };
  }
  return null;
}

export class GraphicsQualityHint {
  constructor({ canShow, lower, once = new QualityHintOnce(), document: doc = globalThis.document,
    setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
    Object.assign(this, { canShow, lower, once, doc, setTimer, clearTimer });
    this.nextAttempt = 0;
  }
  suggest(time) {
    if (this.node) { this.refresh(); return false; }
    if (time < this.nextAttempt || !this.once.available() || !this.canShow()) return false;
    this.nextAttempt = time + 1000;
    const node = this.doc.createElement('aside');
    node.className = 'graphics-quality-hint'; node.setAttribute('aria-label', '画质建议');
    node.innerHTML = '<span role="status">画面持续卡顿？可试试省电模式。</span><div><button type="button" data-quality-lower>降低画质</button><button type="button" data-quality-keep>保持高画质</button><button type="button" data-quality-close aria-label="关闭画质建议">×</button></div>';
    node.style.visibility = 'hidden'; this.doc.body.append(node); this.node = node;
    if (!this.position()) { node.remove(); this.node = null; return false; }
    node.querySelector('[data-quality-lower]').onclick = () => { if (this.node !== node) return; this.dismiss(); this.lower(); };
    node.querySelector('[data-quality-keep]').onclick = () => this.dismiss();
    node.querySelector('[data-quality-close]').onclick = () => this.dismiss();
    node.onkeydown = event => { if (event.key === 'Escape') { event.stopPropagation(); this.dismiss(); } };
    node.style.visibility = 'visible'; this.once.shown();
    // No focus change, backdrop, pause, or automatic quality change. Ignoring expires it.
    this.timer = this.setTimer(() => this.dismiss(), 12000);
    return true;
  }
  position() {
    const { node, doc } = this;
    if (!node || !this.canShow()) return false;
    const viewport = doc.defaultView?.visualViewport;
    const left = viewport?.offsetLeft || 0, top = viewport?.offsetTop || 0;
    const right = left + (viewport?.width || doc.documentElement.clientWidth);
    const bottom = top + (viewport?.height || doc.documentElement.clientHeight);
    const obstacles = [...doc.querySelectorAll(QUALITY_HINT_OBSTACLES)].filter(n => n.getClientRects().length)
      .map(n => n.getBoundingClientRect()).filter(r => r.width && r.height);
    const box = node.getBoundingClientRect();
    const position = qualityHintPosition(box.width, box.height, { left, top, right, bottom }, obstacles);
    if (!position) return false;
    node.style.left = `${position.x}px`; node.style.top = `${position.y}px`;
    return true;
  }
  refresh() { if (this.node && !this.position()) this.dismiss(); }
  dismiss() {
    this.clearTimer(this.timer); this.timer = null;
    this.node?.remove(); this.node = null;
  }
}
