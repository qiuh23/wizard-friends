import { cardImage } from './card-art.js';
import { cardMark, cardMarksHTML } from './card-face.js';
import { SUIT_NAMES } from './game.js';
import { trumpStyle } from './trump-style.js';

export function trumpPresentation(state) {
  const appearance = trumpStyle(state);
  if (state.options?.deckMode === 'mono') {
    return { ...appearance, card: null, cardLabel: '', status: 'mono', label: '本轮无主牌 · 单色牌库', compactLabel: '本轮无主牌' };
  }
  const card = state.reveal || null;
  const cardLabel = !card ? '' : card.kind === 'number' ? `${SUIT_NAMES[card.suit]} ${card.rank}` : card.kind === 'wizard' ? '巫师' : '小丑';
  if (appearance.pending) return { ...appearance, card, cardLabel, status: 'pending', label: '等待庄家选择主牌', compactLabel: '等待庄家选择主牌' };
  if (state.trump) return { ...appearance, card, cardLabel, status: 'suit', label: `本轮主牌：${SUIT_NAMES[state.trump].split(' · ')[0]}色${card?.kind === 'wizard' ? '（巫师指定）' : ''}`,
    compactLabel: `主牌：${SUIT_NAMES[state.trump].split(' · ')[0]}色` };
  return { ...appearance, card, cardLabel, status: card?.kind === 'jester' ? 'jester' : 'exhausted', label: card?.kind === 'jester' ? '本轮无主牌 · 翻开小丑' : '本轮无主牌 · 牌库已用尽',
    compactLabel: '本轮无主牌' };
}

function symbol(display) {
  return display.suit === 'none' ? display.status === 'pending' ? '✦' : '∅' : cardMark({kind:'number',suit:display.suit}).symbol;
}
function faceElement(card) {
  const face = document.createElement('div');
  face.className = 'card trump-card-face';
  face.style.backgroundImage = `url('${cardImage(card)}')`;
  face.style.setProperty('--card-color', cardMark(card).color);
  face.innerHTML = cardMarksHTML(card);
  return face;
}

export function renderTrumpDisplay(table, state) {
  const display = trumpPresentation(state);
  table.style.setProperty('--trump-color', display.color);
  table.dataset.trumpSuit = display.suit;
  table.querySelector('.trump-display')?.remove();
  const root = document.createElement('div');
  root.className = 'trump-display';
  root.dataset.state = display.status;
  root.dataset.presentation = 'badge';
  root.dataset.occluded = 'true';
  root.setAttribute('role', 'status');
  root.setAttribute('aria-live', 'polite');
  root.setAttribute('aria-atomic', 'true');
  const label = document.createElement(display.card ? 'button' : 'div');
  label.className = 'table-trump';
  label.title = display.label;
  label.innerHTML = `<span class="trump-suit-icon" aria-hidden="true">${symbol(display)}</span><span>${display.compactLabel}</span>`;
  if (display.card) {
    label.type = 'button';
    label.setAttribute('aria-label', `${display.label}，查看翻牌 ${display.cardLabel}`);
    label.onclick = () => {
      const dialog = document.createElement('dialog');
      dialog.className = 'trump-preview';
      const title = document.createElement('p'); title.textContent = display.label;
      const face = faceElement(display.card); face.classList.add('trump-preview-face');
      face.setAttribute('aria-label', display.cardLabel);
      const close = document.createElement('button'); close.textContent = '返回牌桌';
      close.onclick = () => dialog.close();
      dialog.append(title,face,close); root.append(dialog);
      dialog.addEventListener('close', () => { dialog.remove(); label.focus(); });
      dialog.showModal();
    };
  }
  root.append(label);
  table.append(root);
}

export function layoutTrumpDisplay(table) {
  const root = table?.querySelector('.trump-display');
  if (!root) return;
  const box = table.getBoundingClientRect();
  const round = document.querySelector('.roundbar')?.getBoundingClientRect();
  if (round) {
    root.style.left = `${round.left - box.left}px`;
    root.style.top = `${round.bottom + 4 - box.top}px`;
  }
}

const EXTRACT_MS = 300, FLIP_MS = 400, HOLD_MS = 1200, RETURN_MS = 500;
const HOLD_AT = EXTRACT_MS + FLIP_MS, RETURN_AT = HOLD_AT + HOLD_MS;
export const TRUMP_REVEAL_MS = RETURN_AT + RETURN_MS;
const clamp = n => Math.max(0, Math.min(1, n));
const smooth = n => { const t = clamp(n); return t * t * (3 - 2 * t); };

// A presentation-only clock. Existing round events identify real deals in both
// authority snapshots and practice. No state mutation, timers or random draws.
export class TrumpReveal {
  constructor(clock = () => performance.now()) {
    this.clock = clock;
    this.scope = null; this.seq = -1; this.round = 0;
    this.display = null; this.effect = null; this.pulseAt = null;
  }
  sync(state, { initial = false, scope = '', serverNow = Date.now(), motion = true } = {}) {
    const reset = initial || this.scope !== scope;
    const previous = this.display, previousSeq = this.seq, previousRound = this.round;
    this.scope = scope; this.motion = motion;
    this.seq = reset ? state?.eventSeq || 0 : Math.max(this.seq, state?.eventSeq || 0);
    this.round = state?.round || 0;
    this.display = state ? trumpPresentation(state) : null;
    if (reset || !state || !state.round || ['lobby','rules','finished','roundEnd'].includes(state.phase) || !motion || state.lifecycle?.paused || state.trick?.length) {
      this.finish(); return;
    }
    const event = state.events?.find(e => e.type === 'round' && e.round === state.round);
    const age = event ? Math.max(0, serverNow - event.time) : Infinity;
    if (event?.seq > previousSeq && state.round !== previousRound && age < TRUMP_REVEAL_MS) {
      this.finish();
      this.effect = { key: `${scope}:${state.round}:${event.seq}`, type: this.display.card ? 'reveal' : 'text',
        display: this.display, start: this.clock() };
    } else if (previous?.status === 'pending' && this.display.status === 'suit' && previousRound === this.round) {
      // A fast dealer may choose before the reveal ends. Settle immediately and
      // emphasize the confirmed suit, without extraction or a stale label.
      this.finish(true);
    }
  }
  finish(emphasize = false) {
    this.root?.remove(); this.root = null; this.geometry = null;
    this.card = this.rotor = this.label = this.sheen = null;
    this.effect = null; this.pulseAt = emphasize && this.motion ? this.clock() : null;
    this.badge?.style.removeProperty('opacity');
    this.icon?.style.removeProperty('filter');
  }
  mount(table, deckRect = null) {
    this.badge = table?.querySelector('.table-trump');
    this.icon = this.badge?.querySelector('.trump-suit-icon');
    if (!this.badge) { this.finish(); return; }
    if (this.effect?.type !== 'reveal' || this.root) { this.draw(); return; }
    const root = document.createElement('div'); root.className = 'trump-reveal';
    root.dataset.key = this.effect.key; root.setAttribute('aria-hidden', 'true');
    root.style.setProperty('--trump-color', this.effect.display.color);
    const card = document.createElement('div'); card.className = 'trump-reveal-card';
    const rotor = document.createElement('div'); rotor.className = 'trump-reveal-rotor';
    const face = faceElement(this.effect.display.card); face.classList.add('trump-reveal-front');
    const back = document.createElement('div'); back.className = 'trump-reveal-back'; back.textContent = '✦';
    const sheen = document.createElement('div'); sheen.className = 'trump-reveal-sheen';
    rotor.append(face,back); card.append(rotor,sheen);
    const label = document.createElement('div'); label.className = 'trump-reveal-label';
    label.textContent = `${symbol(this.effect.display)} ${this.effect.display.label}`;
    root.append(card,label); document.body.append(root);
    this.root = root; this.card = card; this.rotor = rotor; this.label = label; this.sheen = sheen;
    const box = table.getBoundingClientRect();
    const shown = node => node.offsetWidth && node.offsetHeight && getComputedStyle(node).visibility !== 'hidden';
    const players = [...table.querySelectorAll('.opponents .player')].filter(shown).map(n => n.getBoundingClientRect());
    const centerX = box.left + box.width / 2;
    const gap = table.dataset.layoutMode === 'strip' ? 6 : 12;
    const top = Math.max(box.top + box.height * .19, ...players.filter(r => r.left < centerX+70 && r.right > centerX-70).map(r => r.bottom + gap));
    const docks = [...document.querySelectorAll('.own-status,.action-panel,.hand-section')].filter(shown).map(n => n.getBoundingClientRect());
    const bottom = Math.min(box.bottom - 24, ...docks.filter(r => r.top > top && r.left < centerX+110 && r.right > centerX-110).map(r => r.top-8));
    const width = Math.max(44, Math.min(120, (bottom - top - 38) / 1.5));
    const center = { x:centerX, y:top + width * .75 };
    this.geometry = { width, center, origin: deckRect ? { x:deckRect.left + deckRect.width/2, y:deckRect.top + deckRect.height/2 } : { x:center.x, y:center.y + 32 } };
    card.style.width = `${width}px`; card.style.height = `${width * 1.5}px`;
    label.style.left = `${center.x}px`; label.style.top = `${center.y + width * .75 + 8}px`;
    this.draw();
  }
  draw() {
    const now = this.clock();
    if (this.effect) {
      const elapsed = now - this.effect.start;
      if (this.effect.type === 'text') {
        if (elapsed >= 220) this.finish();
        else if (this.badge) this.badge.style.opacity = String(.45 + .55 * smooth(elapsed / 220));
      } else if (elapsed >= TRUMP_REVEAL_MS) this.finish(true);
      else if (this.root && this.geometry && this.icon?.isConnected) {
        const { width, center, origin } = this.geometry;
        const target = this.icon.getBoundingClientRect();
        const extract = smooth(elapsed / EXTRACT_MS), returning = smooth((elapsed - RETURN_AT) / RETURN_MS);
        const end = { x:target.left + target.width/2, y:target.top + target.height/2 };
        const x = returning ? (1-returning)**2*center.x + 2*(1-returning)*returning*(center.x+(end.x-center.x)*.45) + returning**2*end.x : origin.x + (center.x-origin.x)*extract;
        const y = returning ? (1-returning)**2*center.y + 2*(1-returning)*returning*(Math.min(center.y,end.y)-24) + returning**2*end.y : origin.y + (center.y-origin.y)*extract;
        const scale = returning ? 1-(1-target.width/width)*returning : .65+.35*extract;
        this.root.dataset.phase = elapsed < EXTRACT_MS ? 'extract' : elapsed < HOLD_AT ? 'flip' : elapsed < RETURN_AT ? 'hold' : 'return';
        this.card.style.transform = `translate3d(${x-width/2}px,${y-width*.75}px,0) scale(${scale}) rotate(${(1-extract)*-10}deg)`;
        this.card.style.opacity = String(1-smooth((returning-.65)/.35));
        this.rotor.style.transform = `rotateY(${180 * (1-smooth((elapsed-EXTRACT_MS)/FLIP_MS))}deg)`;
        this.label.style.opacity = String(smooth((elapsed-HOLD_AT)/70) * (1-clamp((elapsed-RETURN_AT)/100)));
        this.sheen.style.opacity = String(Math.sin(clamp((elapsed-EXTRACT_MS)/FLIP_MS)*Math.PI)*.65);
        this.sheen.style.backgroundPosition = `${100-clamp((elapsed-EXTRACT_MS)/FLIP_MS)*200}% 0`;
      }
    }
    if (this.icon && this.pulseAt !== null) {
      const progress = (now-this.pulseAt)/320;
      if (progress >= 1) { this.icon.style.removeProperty('filter'); this.pulseAt = null; }
      else this.icon.style.filter = `brightness(${1+Math.sin(progress*Math.PI)*.6}) drop-shadow(0 0 ${Math.sin(progress*Math.PI)*6}px currentColor)`;
    }
  }
}
