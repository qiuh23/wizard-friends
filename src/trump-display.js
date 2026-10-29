import { cardImage } from './card-art.js';
import { cardMark, cardMarksHTML } from './card-face.js';
import { SUIT_NAMES } from './game.js';
import { trumpStyle } from './trump-style.js';

export function trumpPresentation(state) {
  const appearance = trumpStyle(state);
  if (state.options?.deckMode === 'mono') {
    return { ...appearance, card: null, cardLabel: '', status: 'mono', label: '无主牌 · 单色牌库', compactLabel: '无主牌 · 单色' };
  }
  const card = state.reveal || null;
  const cardLabel = !card ? '' : card.kind === 'number' ? `${SUIT_NAMES[card.suit]} ${card.rank}` : card.kind === 'wizard' ? '巫师' : '小丑';
  if (appearance.pending) return { ...appearance, card, cardLabel, status: 'pending', label: '等待庄家选择主牌', compactLabel: 'W · 待庄家选色' };
  if (state.trump) return { ...appearance, card, cardLabel, status: 'suit', label: `本轮主牌：${SUIT_NAMES[state.trump].split(' · ')[0]}色${card?.kind === 'wizard' ? '（巫师指定）' : ''}`,
    compactLabel: `${card?.kind === 'wizard' ? 'W → ' : ''}${SUIT_NAMES[state.trump].split(' · ')[0]}色主牌` };
  return { ...appearance, card, cardLabel, status: card?.kind === 'jester' ? 'jester' : 'exhausted', label: card?.kind === 'jester' ? '无主牌 · 翻开小丑' : '无主牌 · 牌库已用尽',
    compactLabel: card?.kind === 'jester' ? 'J · 本轮无主牌' : '无主牌 · 牌库用尽' };
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
  const label = document.createElement(display.card ? 'button' : 'div');
  label.className = 'table-trump';
  label.innerHTML = `<span aria-hidden="true">${display.suit === 'none' ? '✧' : cardMark({kind:'number',suit:display.suit}).symbol || '◆'}</span> ${display.label}`;
  if (display.card) {
    label.type = 'button';
    label.setAttribute('aria-label', `${display.label}，查看翻牌 ${display.cardLabel}`);
    label.onclick = () => {
      const dialog = document.createElement('dialog');
      dialog.className = 'trump-preview';
      const title = document.createElement('p'); title.textContent = display.label;
      const face = document.createElement('div'); face.className = 'card trump-preview-face';
      face.style.backgroundImage = `url('${cardImage(display.card)}')`;
      face.style.setProperty('--card-color', cardMark(display.card).color);
      face.innerHTML = cardMarksHTML(display.card);
      face.setAttribute('aria-label', display.cardLabel);
      const close = document.createElement('button'); close.textContent = '返回牌桌';
      close.onclick = () => dialog.close();
      dialog.append(title,face,close); root.append(dialog);
      dialog.addEventListener('close', () => { dialog.remove(); label.focus(); });
      dialog.showModal();
    };
  } else label.setAttribute('role', 'status');
  root.append(label);
  table.append(root);
}

export function layoutTrumpDisplay(table) {
  const root = table?.querySelector('.trump-display');
  if (!root) return;
  const box = table.getBoundingClientRect();
  const strip = table.dataset.layoutMode === 'strip';
  const badge = !root.querySelector('.trump-card') || (strip && box.height < 420) || (!strip && box.width < 600);
  root.dataset.presentation = badge ? 'badge' : 'card';
  root.dataset.occluded = String(badge || !root.querySelector('.trump-card'));
  root.style.setProperty('--trump-width',`${strip ? 62 : 96}px`);
  root.style.setProperty('--trump-height',`${strip ? 93 : 144}px`);
}
