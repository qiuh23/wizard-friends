import { SUIT_NAMES } from './game.js';
import { TRUMP_COLORS } from './trump-style.js';

const symbols = { blue: '❄', red: '♜', green: '❧', yellow: '✧', wizard: '✦', jester: '☾' };

// Use the same contrast and suit color in HTML and physical card textures.
export function cardMark(card) {
  const number = card.kind === 'number';
  return {
    value: number ? String(card.rank) : card.kind === 'wizard' ? 'W' : 'J',
    name: number ? SUIT_NAMES[card.suit].split(' · ')[0] : card.kind === 'wizard' ? '巫师' : '小丑',
    symbol: symbols[number ? card.suit : card.kind],
    color: number ? TRUMP_COLORS[card.suit] : card.kind === 'wizard' ? '#f3cf66' : '#d9b5f0',
  };
}

export function cardMarksHTML(card) {
  const mark = cardMark(card);
  return `<span class="corner">${mark.value}<small>${mark.symbol}</small></span>`;
}

// Bake every mark into the physical face: no independently animated DOM numbers.
export function paintCardFace(ctx, image, card) {
  const mark = cardMark(card);
  ctx.drawImage(image, 0, 0, 320, 480);
  ctx.strokeStyle = mark.color; ctx.lineWidth = 8;
  ctx.strokeRect(4, 4, 312, 472);
  ctx.fillStyle = '#0b1518'; ctx.fillRect(10, 10, 146, 174);
  ctx.fillStyle = '#fff0cb'; ctx.font = 'bold 108px Georgia, serif';
  ctx.fillText(mark.value, 18, 116);
  ctx.fillStyle = mark.color; ctx.font = 'bold 40px sans-serif';
  ctx.fillText(mark.symbol, 18, 164);
}
