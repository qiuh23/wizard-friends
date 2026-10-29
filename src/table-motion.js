export const CARD_ENTER_MS = 420;
export const CARD_COLLECT_MS = 800;
const progress = (elapsed, duration) => Math.max(0, Math.min(1, elapsed / duration));

// One presentation clock for HTML and WebGL. State updates set the schedule;
// local redraws only read it, so chat, sorting and resizing cannot restart it.
export class TableMotion {
  constructor(now = () => performance.now()) {
    this.now = now;
    this.last = now();
    this.time = 0;
    this.entries = new Map();
    this.collectAt = null;
  }
  clock() {
    const now = this.now();
    if (!this.paused) this.time += Math.max(0, now - this.last);
    this.last = now;
    return this.time;
  }
  sync(state, { initial = false, serverNow = Date.now() } = {}) {
    const time = this.clock();
    const done = ['trickEnd', 'roundEnd', 'finished'].includes(state?.phase);
    const scope = state ? `${state.round}:${state.completedTricks + (done ? 0 : 1)}` : '';
    if (initial || scope !== this.scope) this.entries.clear();
    this.scope = scope;
    this.paused = !!state?.lifecycle?.paused;
    const cards = new Set();
    for (const { card } of state?.trick || []) {
      cards.add(card.id);
      if (this.entries.has(card.id)) continue;
      const event = state.events?.findLast(e => e.type === 'play' && e.round === state.round && e.card?.id === card.id);
      const age = initial ? CARD_ENTER_MS : event ? Math.max(0, serverNow - event.time) : CARD_ENTER_MS;
      this.entries.set(card.id, time - Math.min(CARD_ENTER_MS, age));
    }
    for (const id of this.entries.keys()) if (!cards.has(id)) this.entries.delete(id);
    const life = state?.lifecycle;
    const remaining = this.paused ? life?.reviewRemainingMs
      : Number.isFinite(life?.nextTrickAt) ? life.nextTrickAt - serverNow : null;
    // Practice waits for a manual Next action and must keep the complete trick.
    this.collectAt = state?.phase === 'trickEnd' && Number.isFinite(remaining)
      ? time + Math.max(0, remaining) - CARD_COLLECT_MS : null;
  }
  timing(id) {
    const time = this.clock();
    return {
      enterMs: time - (this.entries.get(id) ?? time - CARD_ENTER_MS),
      collectMs: this.collectAt === null ? null : time - this.collectAt,
    };
  }
  pose(id) {
    const { enterMs, collectMs } = this.timing(id);
    const enter = progress(enterMs, CARD_ENTER_MS);
    const collect = progress(collectMs ?? 0, CARD_COLLECT_MS);
    return { enter: 1 - (1 - enter) ** 3, collect: collect * collect * (3 - 2 * collect) };
  }
}
