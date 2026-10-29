// Adapted from the reference game's bounded live-message bubbles.
export const CHAT_NOTICE_MS = 8000;
export const CHAT_NOTICE_EXIT_MS = 220;
export class ChatNotices {
  constructor() { this.reset(); }
  reset() { this.hydrated = false; this.latest = 0; this.items = []; }
  advance(now = Date.now(), limit = 5) {
    this.items = this.items.filter(n => now < n.expiresAt + CHAT_NOTICE_EXIT_MS).slice(-limit)
      .map(n => ({ ...n, leaving: now >= n.expiresAt }));
    return this.items;
  }
  update(messages, me, connected, now = Date.now(), limit = 5) {
    const fresh = connected && this.hydrated ? messages.filter(m => m.seq > this.latest && m.player !== me) : [];
    this.latest = Math.max(this.latest, 0, ...messages.map(m => m.seq));
    this.hydrated = connected;
    if (!connected) this.items = [];
    this.advance(now, limit);
    for (const message of [...fresh].sort((a,b) => a.seq - b.seq)) {
      if (!this.items.some(n => n.message.seq === message.seq)) this.items.push({ message: { ...message }, expiresAt: now + CHAT_NOTICE_MS, leaving: false });
    }
    return this.items = this.items.slice(-limit);
  }
}
