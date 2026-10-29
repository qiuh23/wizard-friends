export const CARD_ENTER_MS = 420;
export const CARD_COLLECT_MS = 1100;
export const CARD_COLLECT_STAGGER_MS = 35;
export const LEADING_CARD_SCALE = 1.06;
const EMPHASIS_MS = 180;
const progress = (elapsed, duration) => Math.max(0, Math.min(1, elapsed / duration));
const smooth = value => value * value * (3 - 2 * value);

// One presentation clock for HTML and WebGL. State updates set the schedule;
// local redraws only read it, so chat, sorting and resizing cannot restart it.
export class TableMotion {
  constructor(now = () => performance.now()) {
    this.now = now;
    this.last = now();
    this.time = 0;
    this.entries = new Map();
    this.emphasis = new Map();
    this.collectAt = null;
  }
  clock() {
    const now = this.now();
    if (!this.paused) this.time += Math.max(0, now - this.last);
    this.last = now;
    return this.time;
  }
  sync(state, { initial = false, serverNow = Date.now(), leader = null } = {}) {
    const time = this.clock();
    const done = ['trickEnd', 'roundEnd', 'finished'].includes(state?.phase);
    const scope = state ? `${state.round}:${state.completedTricks + (done ? 0 : 1)}` : '';
    if (initial || scope !== this.scope) { this.entries.clear(); this.emphasis.clear(); }
    this.scope = scope;
    this.paused = !!state?.lifecycle?.paused;
    const cards = new Set();
    for (const { card } of state?.trick || []) {
      cards.add(card.id);
      const target = card.id === leader ? LEADING_CARD_SCALE : 1;
      const emphasis = this.emphasis.get(card.id);
      if (!emphasis || emphasis.to !== target) {
        this.emphasis.set(card.id, { from: initial ? target : this.emphasisAt(card.id, time), to: target, at: time });
      }
      if (this.entries.has(card.id)) continue;
      const event = state.events?.findLast(e => e.type === 'play' && e.round === state.round && e.card?.id === card.id);
      const age = initial ? CARD_ENTER_MS : event ? Math.max(0, serverNow - event.time) : CARD_ENTER_MS;
      this.entries.set(card.id, time - Math.min(CARD_ENTER_MS, age));
    }
    for (const id of this.entries.keys()) if (!cards.has(id)) { this.entries.delete(id); this.emphasis.delete(id); }
    const life = state?.lifecycle;
    const remaining = this.paused ? life?.reviewRemainingMs
      : Number.isFinite(life?.nextTrickAt) ? life.nextTrickAt - serverNow : null;
    // Practice waits for a manual Next action and must keep the complete trick.
    this.collectAt = state?.phase === 'trickEnd' && Number.isFinite(remaining)
      ? time + Math.max(0, remaining) - CARD_COLLECT_MS : null;
  }
  timing(id) {
    const time = this.clock();
    const order = Math.max(0, [...this.entries.keys()].indexOf(id));
    const collectDurationMs = CARD_COLLECT_MS - Math.max(0, this.entries.size - 1) * CARD_COLLECT_STAGGER_MS;
    return {
      enterMs: time - (this.entries.get(id) ?? time - CARD_ENTER_MS),
      collectMs: this.collectAt === null ? null : time - this.collectAt - order * CARD_COLLECT_STAGGER_MS,
      collectDurationMs,
    };
  }
  emphasisAt(id, time = this.clock()) {
    const emphasis = this.emphasis.get(id);
    return emphasis ? emphasis.from + (emphasis.to - emphasis.from) * smooth(progress(time - emphasis.at, EMPHASIS_MS)) : 1;
  }
  pose(id) {
    const { enterMs, collectMs, collectDurationMs } = this.timing(id);
    const enter = progress(enterMs, CARD_ENTER_MS);
    const collect = smooth(progress(collectMs ?? 0, collectDurationMs));
    return { enter: 1 - (1 - enter) ** 3, collect,
      lift: 18 * 4 * collect * (1 - collect),
      scale: (1 - .65 * collect) * (1 + (this.emphasisAt(id) - 1) * (1 - collect)),
      opacity: 1 - smooth(progress(collect - .65, .35)),
    };
  }
  isAnimating() {
    const time = this.clock();
    return !this.paused && (this.collectAt !== null && time >= this.collectAt && time < this.collectAt + CARD_COLLECT_MS ||
      [...this.entries.values()].some(at => time < at + CARD_ENTER_MS) ||
      [...this.emphasis.values()].some(value => value.from !== value.to && time < value.at + EMPHASIS_MS));
  }
}
