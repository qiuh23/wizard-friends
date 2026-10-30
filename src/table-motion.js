import { TRICK_REVIEW_MS } from './game.js';

export const CARD_ENTER_MS = 260;
export const CARD_COLLECT_MS = 1100;
export const CARD_COLLECT_STAGGER_MS = 35;
export const CARD_LABEL_FADE_MS = 140;
export const LEADING_CARD_SCALE = 1.22;
export const COMPACT_LEADING_CARD_SCALE = 1.15;
const EMPHASIS_MS = 220;
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
    this.manualCollectAt = null;
    this.emphasisScale = LEADING_CARD_SCALE;
  }
  clock() {
    const now = this.now();
    if (!this.paused) this.time += Math.max(0, now - this.last);
    this.last = now;
    return this.time;
  }
  sync(state, { initial = false, serverNow = Date.now(), leader = null,
    emphasisScale = this.emphasisScale, reducedMotion = this.reducedMotion } = {}) {
    this.frameSample = null;
    const time = this.clock();
    const done = ['trickEnd', 'roundEnd', 'finished'].includes(state?.phase);
    const scope = state ? `${state.round}:${state.completedTricks + (done ? 0 : 1)}` : '';
    if (initial || scope !== this.scope) {
      this.entries.clear(); this.emphasis.clear(); this.manualCollectAt = null;
    }
    this.scope = scope;
    this.paused = !!state?.lifecycle?.paused;
    this.leader = leader;
    this.emphasisScale = emphasisScale;
    this.reducedMotion = !!reducedMotion;
    const cards = new Set();
    for (const { card } of state?.trick || []) {
      cards.add(card.id);
      const target = card.id === leader ? emphasisScale : 1;
      const emphasis = this.emphasis.get(card.id);
      if (!emphasis || emphasis.to !== target || this.reducedMotion) {
        this.emphasis.set(card.id, { from: initial || this.reducedMotion ? target : this.emphasisAt(card.id, time), to: target, at: time });
      }
      if (this.entries.has(card.id)) continue;
      const event = state.events?.findLast(e => e.type === 'play' && e.round === state.round && e.card?.id === card.id);
      const age = initial ? CARD_ENTER_MS : event ? Math.max(0, serverNow - event.time) : CARD_ENTER_MS;
      this.entries.set(card.id, time - Math.min(CARD_ENTER_MS, age));
    }
    for (const id of this.entries.keys()) if (!cards.has(id)) { this.entries.delete(id); this.emphasis.delete(id); }
    const life = state?.lifecycle;
    const collectionRemaining = this.paused ? life?.collectionRemainingMs
      : Number.isFinite(life?.collectionAt) ? life.collectionAt - serverNow : null;
    const remaining = this.paused ? life?.reviewRemainingMs
      : Number.isFinite(life?.nextTrickAt) ? life.nextTrickAt - serverNow : null;
    if (done && Number.isFinite(collectionRemaining)) {
      this.collectAt = time + Math.max(0, collectionRemaining) - CARD_COLLECT_MS;
    } else if (state?.phase === 'trickEnd' && Number.isFinite(remaining)) {
      this.collectAt = time + Math.max(0, remaining) - CARD_COLLECT_MS;
    } else if (done && cards.size) {
      // Practice and the final trick have no automatic Next deadline. Their
      // real trickEnd event still provides a shared review/collection origin.
      // Keep it on this clock once observed so pause and redraw cannot move it.
      if (this.manualCollectAt === null) {
        const event = state.events?.findLast(event => event.type === 'trickEnd' &&
          event.round === state.round && event.completedTricks === state.completedTricks);
        if (Number.isFinite(event?.time)) {
          const age = Math.max(0, serverNow - event.time);
          this.manualCollectAt = time + TRICK_REVIEW_MS - CARD_COLLECT_MS - age;
        }
      }
      this.collectAt = this.manualCollectAt;
    } else {
      this.collectAt = null;
    }
  }
  // A new viewport may change emphasis without changing a card's arrival or
  // collection schedule. Read the current scale before retargeting the tween.
  setEmphasisScale(scale, { immediate = this.reducedMotion } = {}) {
    if (this.emphasisScale === scale && !immediate) return;
    this.frameSample = null;
    const time = this.clock();
    this.emphasisScale = scale;
    for (const id of this.entries.keys()) {
      const target = id === this.leader ? scale : 1;
      const previous = this.emphasis.get(id);
      if (previous?.to === target && !immediate) continue;
      this.emphasis.set(id, { from: immediate ? target : this.emphasisAt(id, time), to: target, at: time });
    }
  }
  timing(id, time = this.clock()) {
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
    return emphasis ? this.reducedMotion ? emphasis.to
      : emphasis.from + (emphasis.to - emphasis.from) * smooth(progress(time - emphasis.at, EMPHASIS_MS)) : 1;
  }
  labelOpacity(time = this.clock()) {
    if (this.reducedMotion || this.collectAt === null) return 1;
    return 1 - smooth(progress(time - (this.collectAt - CARD_LABEL_FADE_MS), CARD_LABEL_FADE_MS));
  }
  pose(id, time = this.clock()) {
    if (this.reducedMotion) return { enter: 1, collect: 0, lift: 0, opacity: 1, scale: this.emphasisAt(id, time) };
    const { enterMs, collectMs, collectDurationMs } = this.timing(id, time);
    const enter = progress(enterMs, CARD_ENTER_MS);
    const collect = smooth(progress(collectMs ?? 0, collectDurationMs));
    const emphasis = this.emphasisAt(id, time);
    const leadingLift = 4 * Math.max(0, Math.min(1, (emphasis - 1) / Math.max(.01, this.emphasisScale - 1)));
    return { enter: 1 - (1 - enter) ** 3, collect,
      lift: 18 * 4 * collect * (1 - collect) + leadingLift * (1 - collect),
      scale: (1 - .65 * collect) * (1 + (emphasis - 1) * (1 - collect)),
      opacity: 1 - smooth(progress(collect - .65, .35)),
    };
  }
  isAnimating(time = this.clock()) {
    return !this.paused && !this.reducedMotion && (this.collectAt !== null && time >= this.collectAt - CARD_LABEL_FADE_MS && time < this.collectAt + CARD_COLLECT_MS ||
      [...this.entries.values()].some(at => time < at + CARD_ENTER_MS) ||
      [...this.emphasis.values()].some(value => value.from !== value.to && time < value.at + EMPHASIS_MS));
  }
  nextUpdateDelay(time = this.clock()) {
    if (this.paused || this.reducedMotion || !this.entries.size) return null;
    if (this.isAnimating(time)) return 0;
    const next = this.collectAt === null ? null : this.collectAt - CARD_LABEL_FADE_MS - time;
    return next !== null && next > 0 ? next : null;
  }
  /** HTML and WebGL consume one presentation sample per shared display frame. */
  snapshot(frameTime) {
    if (frameTime !== undefined && this.frameSample?.frameTime === frameTime) return this.frameSample;
    const time = this.clock();
    const sample = { frameTime, time, poses: new Map([...this.entries.keys()].map(id => [id, this.pose(id, time)])),
      labelOpacity: this.labelOpacity(time), animating: this.isAnimating(time), nextDelay: this.nextUpdateDelay(time) };
    if (frameTime !== undefined) this.frameSample = sample;
    return sample;
  }
}
