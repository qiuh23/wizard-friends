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
  return `<span class="corner"><span class="card-value">${mark.value}</span><small>${mark.symbol}</small></span>${card.kind === 'number' ? `<span class="suit-mark" aria-hidden="true">${mark.symbol}</span>` : ''}`;
}

// Bake every mark into the physical face: no independently animated DOM numbers.
export function paintCardFace(ctx, image, card) {
  const mark = cardMark(card);
  // A complete, readable face exists before the illustration is downloaded.
  ctx.fillStyle = '#e8deca'; ctx.fillRect(0, 0, 320, 480);
  if (image) ctx.drawImage(image, 0, 0, 320, 480);
  else {
    ctx.fillStyle = mark.color; ctx.font = 'bold 124px Georgia, serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(mark.symbol, 160, 260);
  }
  ctx.strokeStyle = mark.color; ctx.lineWidth = 8;
  ctx.strokeRect(4, 4, 312, 472);
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  let top = 10;
  // Separate fitted backings leave the illustration visible beside the symbol.
  for (const [text, font, color] of [[mark.value, 'bold 108px Georgia, serif', '#fff0cb'],
    [mark.symbol, 'bold 40px sans-serif', mark.color]]) {
    ctx.font = font;
    const ink = ctx.measureText(text), height = ink.actualBoundingBoxAscent + ink.actualBoundingBoxDescent;
    const width = ink.actualBoundingBoxLeft + ink.actualBoundingBoxRight;
    ctx.fillStyle = '#0b1518'; ctx.fillRect(10, top, Math.ceil(width + 6), Math.ceil(height + 6));
    ctx.fillStyle = color;
    ctx.fillText(text, 13 + ink.actualBoundingBoxLeft, top + 3 + ink.actualBoundingBoxAscent);
    top += height + 9;
  }
  if (card.kind === 'number') {
    ctx.fillStyle = mark.color; ctx.beginPath(); ctx.arc(276, 44, 26, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#0b1518'; ctx.font = 'bold 34px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(mark.symbol, 276, 44);
  }
}
