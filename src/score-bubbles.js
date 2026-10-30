export const SCORE_BUBBLE_MS = 1800;

// Only fresh public settlement events trigger bubbles. Rebuilt DOM nodes share
// the same expiry, so chat, layout changes and repeated snapshots cannot replay.
export class ScoreBubbles {
  constructor(clock = () => performance.now()) {
    this.clock = clock;
    this.scope = null;
    this.seq = 0;
    this.effect = null;
    this.nodes = new Map();
  }
  sync(state, { initial = false, scope = '', serverNow = Date.now() } = {}) {
    const reset = initial || this.scope !== scope, previousSeq = this.seq;
    this.scope = scope;
    this.seq = reset ? state?.eventSeq || 0 : Math.max(this.seq, state?.eventSeq || 0);
    if (reset || !state || !['roundEnd', 'finished'].includes(state.phase) || state.lifecycle?.paused) {
      this.finish(); return;
    }
    const event = state.events?.filter(event => event.type === 'roundEnd' && event.round === state.round && event.seq > previousSeq).at(-1);
    if (!event) return;
    const age = Math.max(0, serverNow - event.time);
    if (!Number.isFinite(age) || age >= SCORE_BUBBLE_MS) return;
    this.finish();
    this.effect = { start: this.clock() - age, results: new Map(event.result
      .filter(result => Number.isFinite(result.delta)).map(result => [result.id, result.delta])) };
  }
  finish() {
    for (const node of this.nodes.values()) node.remove();
    this.nodes.clear(); this.effect = null;
  }
  mount(root) {
    this.draw();
    if (!this.effect) return;
    for (const [avatar, node] of this.nodes) if (!avatar.isConnected) { node.remove(); this.nodes.delete(avatar); }
    for (const avatar of root.querySelectorAll('.avatar[data-player-details]')) {
      const delta = this.effect.results.get(avatar.dataset.playerDetails);
      if (delta === undefined || this.nodes.has(avatar)) continue;
      const node = avatar.ownerDocument.createElement('span');
      node.className = `round-score-bubble ${delta >= 0 ? 'score-gain' : 'score-loss'}`;
      node.textContent = `${delta >= 0 ? '+' : ''}${delta}`;
      node.setAttribute('aria-hidden', 'true');
      node.style.animationDuration = `${SCORE_BUBBLE_MS}ms`;
      node.style.animationDelay = `${-Math.max(0, this.clock() - this.effect.start)}ms`;
      avatar.append(node); this.nodes.set(avatar, node);
    }
  }
  // The shared frame queue schedules just the expiry; CSS handles the motion.
  draw() {
    if (!this.effect) return null;
    const remaining = SCORE_BUBBLE_MS - (this.clock() - this.effect.start);
    if (remaining <= 0) { this.finish(); return null; }
    return remaining;
  }
}
