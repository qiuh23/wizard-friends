import { cardImage } from './card-art.js';
import { cardMark, cardMarksHTML } from './card-face.js';
import { SUIT_NAMES } from './game.js';
import { trumpStyle } from './trump-style.js';
import { openCardSlot } from './table-layout.js';

export function trumpPresentation(state) {
  const appearance = trumpStyle(state);
  if (state.options?.deckMode === 'mono') {
    return { ...appearance, card: null, cardLabel: '', status: 'mono', label: '无主牌 · 单色牌库' };
  }
  const card = state.reveal || null;
  const cardLabel = !card ? '' : card.kind === 'number' ? `${SUIT_NAMES[card.suit]} ${card.rank}` : card.kind === 'wizard' ? '巫师' : '小丑';
  if (appearance.pending) return { ...appearance, card, cardLabel, status: 'pending', label: '等待庄家选择主牌' };
  if (state.trump) return { ...appearance, card, cardLabel, status: 'suit', label: `主牌 · ${SUIT_NAMES[state.trump]}${card?.kind === 'wizard' ? '（巫师指定）' : ''}` };
  return { ...appearance, card, cardLabel, status: card?.kind === 'jester' ? 'jester' : 'exhausted', label: card?.kind === 'jester' ? '无主牌 · 翻开小丑' : '无主牌 · 牌库已用尽' };
}

export function renderTrumpDisplay(table, state) {
  const display = trumpPresentation(state);
  table.style.setProperty('--trump-color', display.color);
  table.dataset.trumpSuit = display.suit;
  table.querySelector('.trump-display')?.remove();
  const root = document.createElement('div');
  root.className = 'trump-display';
  root.dataset.state = display.status;
  if (display.card) {
    const card = document.createElement('div');
    card.className = 'trump-card';
    card.setAttribute('aria-label', `翻开的主牌：${display.cardLabel}`);
    const rotor = document.createElement('div');
    rotor.className = 'trump-card-rotor';
    for (const side of ['front', 'back']) {
      const face = document.createElement('div');
      face.className = `card trump-card-face trump-card-${side}`;
      face.style.backgroundImage = `url('${cardImage(display.card)}')`;
      face.style.setProperty('--card-color', cardMark(display.card).color);
      face.innerHTML = cardMarksHTML(display.card);
      face.setAttribute('aria-hidden', 'true');
      rotor.append(face);
    }
    card.append(rotor);
    root.append(card);
  } else {
    const sigil = document.createElement('span');
    sigil.className = 'trump-neutral-sigil';
    sigil.textContent = '✧';
    sigil.setAttribute('aria-hidden', 'true');
    root.append(sigil);
  }
  const label = document.createElement('div');
  label.className = 'table-trump';
  label.textContent = display.label;
  label.setAttribute('role', 'status');
  root.append(label);
  table.append(root);
}

export function layoutTrumpDisplay(table) {
  const root = table?.querySelector('.trump-display');
  if (!root?.querySelector('.trump-card')) return;
  const box = table.getBoundingClientRect();
  const visible = selector => [...document.querySelectorAll(selector)].filter(el => {
    const style = getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && el.getBoundingClientRect().height > 0;
  }).map(el => el.getBoundingClientRect());
  const header = visible('.game-toolbar, .roundbar');
  const dock = visible('.own-status, .action-panel, .hand-section');
  const area = { left:box.left+8, right:box.right-8,
    top:Math.max(box.top+8,...header.map(r=>r.bottom+12)), bottom:Math.min(box.bottom-8,...dock.map(r=>r.top-10)) };
  const obstacles = visible('.opponents .player, .played, .foresight-hands, .lifecycle-banner');
  const width = box.width > 850 ? 100 : box.width > box.height ? 76 : 94;
  const preferred = { x:box.left+box.width/2, y:area.top+(area.bottom-area.top)*.7 };
  let slot = null, best = Infinity;
  for (const scale of [1, .8, .65]) {
    const candidate = openCardSlot(area, obstacles, width*scale, width*1.5*scale, preferred);
    if (!candidate) continue;
    const score = (candidate.x-preferred.x)**2*2+(candidate.y-preferred.y)**2+(width-candidate.width)**2*4;
    if (score < best) { slot = candidate; best = score; }
  }
  root.dataset.occluded = String(!slot);
  if (!slot) return;
  Object.assign(root.style, { left:`${slot.x-box.left}px`, top:`${slot.y-box.top}px` });
  root.style.setProperty('--trump-width',`${slot.width}px`);
  root.style.setProperty('--trump-height',`${slot.height}px`);
}
