/** A single demand-driven frame queue. Delays schedule work, never game time. */
export class FrameScheduler {
  constructor({ now = () => performance.now(), requestFrame = callback => requestAnimationFrame(callback),
    cancelFrame = id => cancelAnimationFrame(id), setTimer = (callback, delay) => setTimeout(callback, delay),
    clearTimer = id => clearTimeout(id) } = {}) {
    Object.assign(this, { now, requestFrame, cancelFrame, setTimer, clearTimer });
    this.clients = new Set();
    this.frame = this.timer = null;
    this.suspended = false;
  }
  /** draw receives the shared RAF timestamp and returns its next delay, or null. */
  add(draw, { priority = 0 } = {}) {
    const client = { draw, priority, due: Infinity };
    this.clients.add(client);
    return {
      request: (delay = 0) => {
        if (!this.clients.has(client)) return;
        client.due = Math.min(client.due, this.now() + Math.max(0, delay));
        this.schedule();
      },
      cancel: () => { client.due = Infinity; this.schedule(); },
      dispose: () => { this.clients.delete(client); this.schedule(); },
    };
  }
  setSuspended(value) {
    this.suspended = value;
    // The visible frame must refresh textures and geometry even if a client was idle.
    if (!value) for (const client of this.clients) client.due = this.now();
    this.schedule();
  }
  schedule() {
    if (this.running) return;
    if (this.timer !== null) { this.clearTimer(this.timer); this.timer = null; }
    const due = Math.min(...[...this.clients].map(client => client.due));
    if (this.suspended || !Number.isFinite(due)) {
      if (this.frame !== null) { this.cancelFrame(this.frame); this.frame = null; }
      return;
    }
    // Near work shares the next display frame. Distant work keeps no RAF alive.
    if (due - this.now() > 17) {
      if (this.frame !== null) { this.cancelFrame(this.frame); this.frame = null; }
      this.timer = this.setTimer(() => { this.timer = null; this.schedule(); }, Math.max(1, due - this.now() - 16));
    } else if (this.frame === null) {
      this.frame = this.requestFrame(time => this.flush(time));
    }
  }
  flush(time) {
    this.frame = null;
    if (this.suspended) return;
    this.running = true;
    const visited = new Set();
    try {
      while (true) {
        const client = [...this.clients].filter(item => !visited.has(item) && item.due <= Math.max(time, this.now()) + 1)
          .sort((a, b) => a.priority - b.priority)[0];
        if (!client) break;
        visited.add(client); client.due = Infinity;
        const delay = client.draw(time);
        if (delay !== null && delay !== undefined && Number.isFinite(delay) && this.clients.has(client)) {
          client.due = Math.min(client.due, time + Math.max(0, delay));
        }
      }
    } finally {
      this.running = false;
      this.schedule();
    }
  }
}

export const frameScheduler = new FrameScheduler();
if (typeof document !== 'undefined' && document.addEventListener) {
  frameScheduler.suspended = document.hidden;
  document.addEventListener('visibilitychange', () => frameScheduler.setSuspended(document.hidden));
  globalThis.addEventListener?.('pageshow', () => frameScheduler.setSuspended(document.hidden));
}
