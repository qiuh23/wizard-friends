/** Only an explicit saved choice enables low graphics. Viewport is layout, not consent. */
export const GRAPHICS_PREFERENCE_KEY = 'wizard-low-graphics';
export const QUALITY_HINT_SEEN_KEY = 'wizard-quality-hint-shown';
export function graphicsStorage() {
  try { return globalThis.localStorage; } catch { return null; }
}
export function readLowGraphics(storage = graphicsStorage()) {
  try { return storage?.getItem(GRAPHICS_PREFERENCE_KEY) === 'true'; } catch { return false; }
}
export function saveLowGraphics(value, storage = graphicsStorage()) {
  try { storage?.setItem(GRAPHICS_PREFERENCE_KEY, String(Boolean(value))); } catch { /* The current choice still works. */ }
}

/** Observed scheduling cadence, NOT GPU/render duration. No extra RAF or timer. */
export class SlowFrameAdviser {
  constructor() { this.reset(0, 5000); }
  reset(time, grace = 1500) {
    this.readyAt = Math.max(this.readyAt || 0, time + grace);
    this.previous = null; this.elapsed = this.samples = this.slow = this.badWindows = 0;
    this.pendingUntil = 0;
  }
  sample(time, nextDelay, eligible) {
    if (!Number.isFinite(time)) return false;
    if (!eligible || nextDelay === null || !Number.isFinite(nextDelay) || nextDelay > 50) {
      this.reset(time); return false;
    }
    const previous = this.previous;
    this.previous = { time, delay: nextDelay };
    if (time < this.readyAt || !previous) return false;
    const delta = time - previous.time;
    // Long gaps, focus changes, suspensions and clock discontinuities are not evidence.
    if (delta <= 0 || delta > 1000) { this.reset(time); return false; }
    if (this.pendingUntil > time) return true;
    // Allow normal 30 Hz ambient / 20 Hz power-saving and slow-refresh displays.
    // Compare against the delay requested by the *previous* rendered frame.
    const slow = delta > Math.max(80, previous.delay * 2.5);
    this.elapsed += delta; this.samples++; if (slow) this.slow++;
    if (this.elapsed >= 2500 && this.samples >= 24) {
      this.badWindows = this.slow / this.samples >= .7 ? this.badWindows + 1 : 0;
      this.elapsed = this.samples = this.slow = 0;
      if (this.badWindows >= 2) {
        this.badWindows = 0; this.pendingUntil = time + 30000; return true;
      }
    }
    return false;
  }
}

/** The persisted marker is written only once the non-modal hint is actually shown. */
export class QualityHintOnce {
  constructor(storage = graphicsStorage()) { this.storage = storage; this.consumed = false; }
  available() {
    if (this.consumed) return false;
    try { return this.storage?.getItem(QUALITY_HINT_SEEN_KEY) !== 'true'; } catch { return true; }
  }
  shown() {
    this.consumed = true;
    try { this.storage?.setItem(QUALITY_HINT_SEEN_KEY, 'true'); } catch { /* Once per page when storage is blocked. */ }
  }
}
