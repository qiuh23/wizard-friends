import { relativeSeat, seatPosition } from './hand-model.js';
import { LEADING_CARD_SCALE, COMPACT_LEADING_CARD_SCALE } from './table-motion.js';
import { tableLayoutMode, playedCardRect, playedCardSlots, playedCardLink,
  stripCardSlots, compactCardSlots, shortSeatName } from './table-layout.js';

const layouts = new WeakMap();
const $ = selector => document.querySelector(selector);
const all = selector => [...document.querySelectorAll(selector)];
function css(node, property, value) {
  const text = String(value);
  if (node && node.style.getPropertyValue(property) !== text) node.style.setProperty(property, text);
}
function data(node, property, value) {
  const text = String(value);
  if (node.dataset[property] !== text) node.dataset[property] = text;
}
function attribute(node, name, value) {
  const text = String(value);
  if (node.getAttribute(name) !== text) node.setAttribute(name, text);
}

// Positions of the animated face are deliberately excluded: only stable docks,
// owners and layout inputs may change the public cards' established slots.
function layoutInputs(table, state, me, reducedMotion, metrics) {
  const nodes = [table, ...metrics, ...all('.opponents [data-player],.opponents .avatar,.own-status .avatar,.hand-section,.hand-section.expanded > .play-confirm,.trump-display,.roundbar,.foresight-hands,.lifecycle-banner,.play-confirm')];
  const geometry = nodes.map(node => {
    if (!node) return null;
    const rect = node.getBoundingClientRect(), style = getComputedStyle(node);
    return [rect.left, rect.top, rect.width, rect.height, style.display, style.visibility];
  });
  const padding = getComputedStyle(table);
  const key = JSON.stringify([geometry, padding.paddingLeft, padding.paddingRight,
    window.innerWidth, window.innerHeight, document.body.classList.contains('hand-expanded'),
    document.body.classList.contains('hand-collapsed'), me, reducedMotion, !!state.lifecycle?.paused,
    state.players.map(player => [player.id, player.name]),
    [...table.querySelectorAll('.played')].map(node => [node.dataset.player, node.dataset.cardId, node.classList.contains('winner')])]);
  nodes.push(...table.querySelectorAll('.played,.played .card,.played-name,.played-links'));
  return { key, nodes };
}
function sameInputs(a, b) {
  return a?.key === b.key && a.nodes.length === b.nodes.length && a.nodes.every((node, index) => node === b.nodes[index]);
}

/**
 * Update the existing table's geometry, without altering game or motion time.
 * @returns {boolean} Whether table layout was recalculated.
 */
export function updateTableLayout({ state, me, tableMotion, reducedMotion = false, drawHTMLCards, force = false }) {
  const metrics = [$('#room-chat'), $('.action-panel'), $('.own-status')];
  const table = $('.table'), played = $('.played-cards');
  const input = table && state ? layoutInputs(table, state, me, reducedMotion, metrics) : null;
  if (!force && input && sameInputs(layouts.get(table), input)) return false;

  if (!table || !state) return false;
  const avatars = new Map(all('.opponents [data-player]').map(node => [node.dataset.player, node.querySelector('.avatar')]));
  if (me) avatars.set(me, $('.own-status .avatar'));
  const rect = table.getBoundingClientRect();
  const mode = tableLayoutMode(rect.width, rect.height), strip = mode === 'strip';
  data(table, 'layoutMode', mode); data(document.body, 'tableLayout', mode);
  data(table, 'lowHeight', strip && rect.height <= 340);
  // Mode changes affect dock height. Measure the resulting layout before
  // caching it, so rotation cannot leave a height from the previous mode.
  const heights = metrics.map(node => node?.getBoundingClientRect().height || 0);
  ['--chat-panel-height', '--action-panel-height', '--own-status-height'].forEach((name, index) => css(document.body, name, `${heights[index]}px`));
  const emphasis = strip ? COMPACT_LEADING_CARD_SCALE : LEADING_CARD_SCALE;
  css(table, '--leader-scale', emphasis);
  tableMotion.setEmphasisScale(emphasis, { immediate: reducedMotion || !!state.lifecycle?.paused });
  const low = strip && rect.height <= 340, shortPortrait = mode === 'portrait-grid';
  const self = Math.max(0, state.players.findIndex(player => player.id === me));
  const ordered = state.players.map((player, index) => ({ id: player.id, index, seat: relativeSeat(index, self, state.players.length) })).sort((a, b) => a.seat - b.seat);
  const hasOwnSeat = state.players.some(player => player.id === me);
  const tableStyle = getComputedStyle(table);
  const side = Math.max(10, parseFloat(tableStyle.paddingLeft) || 0);
  const rightSide = Math.max(10, parseFloat(tableStyle.paddingRight) || 0);
  const area = { left: rect.left + side, right: rect.right - rightSide,
    top: rect.top + (strip ? low ? 82 : rect.height >= 420 ? 154 : 126 : shortPortrait ? 154 : rect.width < 600 ? 194 : 158),
    bottom: rect.bottom - (strip ? low ? 88 : 104 : shortPortrait ? 210 : rect.width < 600 ? 260 : 280) };
  const docks = all('.own-status,.hand-section,.action-panel,.hand-section.expanded > .play-confirm')
    // The expanded hand is a temporary overlay on a short landscape table.
    // Keep the public trick in its normal lane underneath it.
    .filter(node => !(strip && node.matches('.hand-section.expanded')))
    .map(node => ({ rect: node.getBoundingClientRect(), style: getComputedStyle(node) }));
  for (const dock of docks) {
    if (dock.rect.height && dock.style.display !== 'none' && dock.style.visibility !== 'hidden') area.bottom = Math.min(area.bottom, dock.rect.top - 8);
  }
  const opponentCount = ordered.length - (hasOwnSeat ? 1 : 0);
  const seatWidth = shortPortrait ? Math.min(68, (rect.width - side - rightSide) / opponentCount - 6) : strip ? Math.min(108, (rect.width - side - rightSide) / ordered.length - 8) : rect.width < 600 ? 68 : 78;
  css(table, '--seat-width', `${seatWidth}px`);
  const safeTop = Math.max(0, parseFloat(tableStyle.paddingTop) || 0);
  const seatTop = Math.max(rect.width < 600 ? 132 : 98, safeTop + 98);
  const seatBottom = rect.height - (shortPortrait ? 250 : rect.width < 600 ? 290 : 300);
  const seatWrites = ordered.map(player => {
    const node = table.querySelector('.opponents [data-player="' + player.id + '"]');
    const pos = seatPosition(player.index, self, state.players.length);
    const rawX = shortPortrait ? side + (rect.width - side - rightSide) / opponentCount * (player.seat + (hasOwnSeat ? -.5 : .5)) : strip ? side + (rect.width - side - rightSide) / ordered.length * (player.seat + .5) : side + (rect.width - side - rightSide) * pos.x / 100;
    const x = Math.max(side + seatWidth / 2, Math.min(rect.width - rightSide - seatWidth / 2, rawX));
    const y = shortPortrait ? Math.max(110, safeTop + 94) : strip ? Math.max(low ? 84 : 92, safeTop + 76) : seatTop + (pos.y - 12) / 78 * Math.max(80, seatBottom - seatTop);
    return { node, x, y };
  });
  const round = $('.roundbar')?.getBoundingClientRect(), trump = table.querySelector('.trump-display');
  for (const { node, x, y } of seatWrites) {
    css(node, '--seat-x', `${x}px`); css(node, '--seat-y', `${y}px`);
  }
  // Compact rows now include both numbers. Reserve their measured bottom,
  // rather than assuming an avatar-only row above the public cards.
  if (strip || shortPortrait) {
    const seatBottoms = seatWrites.filter(({ node }) => node).map(({ node }) => node.getBoundingClientRect().bottom);
    area.top = Math.max(area.top, ...seatBottoms.map(bottom => bottom + 8));
  }
  if (rect.width <= 850 && rect.height > rect.width && document.body.classList.contains('hand-expanded')) {
    const expandedHand = $('.hand-section.expanded')?.getBoundingClientRect();
    if (expandedHand?.height) {
      // The portrait grid temporarily covers the public trick. Keep its
      // anchors under that overlay, clear of the elevated status and button.
      area.top = Math.max(area.top, expandedHand.top + 8);
      area.bottom = expandedHand.bottom - 8;
    }
  }
  if (trump && round) {
    css(trump, 'left', `${round.left - rect.left}px`); css(trump, 'top', `${round.bottom + 4 - rect.top}px`);
  }

  const avatarRects = new Map([...avatars].map(([id, avatar]) => [id, avatar?.getBoundingClientRect()]));
  if (played && avatars.size) {
    const obstacles = all('.opponents .player,.trump-display,.foresight-hands,.lifecycle-banner,.play-confirm')
      .filter(node => node.offsetWidth && node.offsetHeight && getComputedStyle(node).visibility !== 'hidden').map(node => node.getBoundingClientRect());
    const center = { x: (area.left + area.right) / 2, y: (area.top + area.bottom) / 2 };
    const seats = ordered.map(player => {
      const avatar = avatarRects.get(player.id);
      return { id: player.id, self: player.id === me, x: player.seat === 0 ? center.x : avatar ? avatar.left + avatar.width / 2 : center.x,
        y: player.seat === 0 ? area.bottom + 80 : avatar ? avatar.top + avatar.height / 2 : center.y };
    });
    const preferredWidth = strip ? low ? 56 : 84 : rect.width < 600 ? 62 : 94;
    const layout = strip ? stripCardSlots(area, seats, preferredWidth, emphasis) : shortPortrait ? compactCardSlots(area, seats, preferredWidth, emphasis) : playedCardSlots(area, seats, center, obstacles, preferredWidth, emphasis, 46);
    data(played, 'layout', layout ? mode : 'unavailable');
    let links = played.querySelector('.played-links');
    if (!links) {
      links = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); links.classList.add('played-links');
      links.setAttribute('aria-hidden', 'true'); played.prepend(links);
    }
    attribute(links, 'viewBox', `0 0 ${rect.width} ${rect.height}`);
    const linkTargets = [];
    if (layout) {
      css(played, '--played-width', `${layout.width}px`);
      for (const node of played.querySelectorAll('.played')) {
        const slot = layout.slots.get(node.dataset.player), player = ordered.find(player => player.id === node.dataset.player);
        if (!slot) continue;
        css(node, '--play-x', `${slot.x - rect.left}px`); css(node, '--play-y', `${slot.y - rect.top}px`);
        css(node, '--player-color', avatars.get(player.id)?.style.getPropertyValue('--avatar-color') || '#f3ead6');
        const name = node.querySelector('.played-name'), text = shortSeatName(state.players[player.index].name, player.seat, player.id === me);
        if (name.textContent !== text) name.textContent = text;
        if (!strip && !shortPortrait && seats.length >= 5 && player.id !== me && avatarRects.get(player.id)) linkTargets.push({ node, player });
      }
    }
    // Read all established destinations before updating connection lines and
    // collection offsets; avoid a read/write pair for every card.
    const lineData = linkTargets.map(({ node, player }) => {
      const avatar = avatars.get(player.id), actual = avatarRects.get(player.id);
      const source = { x: actual.left + actual.width / 2, y: actual.top + actual.height / 2 };
      return { link: playedCardLink(source, avatar.closest('.player,.own-status').getBoundingClientRect(), node.getBoundingClientRect()), color: avatar.style.getPropertyValue('--avatar-color') };
    }).filter(({ link }) => link);
    while (links.childElementCount > lineData.length) links.lastElementChild.remove();
    lineData.forEach(({ link, color }, index) => {
      let line = links.children[index];
      if (!line) { line = document.createElementNS('http://www.w3.org/2000/svg', 'line'); links.append(line); }
      for (const name of ['x1', 'x2']) attribute(line, name, link[name] - rect.left);
      for (const name of ['y1', 'y2']) attribute(line, name, link[name] - rect.top);
      attribute(line, 'stroke', color);
    });
  }
  const winnerRect = avatarRects.get($('.played.winner')?.dataset.player);
  const cardRects = all('.played').map(node => ({ node, card: playedCardRect(node) }));
  for (const { node, card } of cardRects) {
    for (const [prefix, avatar] of [['from', avatarRects.get(node.dataset.player)], ['winner', winnerRect]]) {
      css(node, `--${prefix}-${prefix === 'from' ? 'x' : 'dx'}`, `${avatar ? avatar.left + avatar.width / 2 - card.x : 0}px`);
      css(node, `--${prefix}-${prefix === 'from' ? 'y' : 'dy'}`, `${avatar ? avatar.top + avatar.height / 2 - card.y : 0}px`);
    }
  }
  layouts.set(table, layoutInputs(table, state, me, reducedMotion, metrics));
  drawHTMLCards?.();
  return true;
}
