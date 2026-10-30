// Only presentation inputs participate. Social feeds have their own persistent
// regions; absolute authority deadlines identify the running presentation clock.
export function tableViewKey(state, context) {
  if (!state) return null;
  const { chat, chatSeq, events, eventSeq, publicEvents, publicEventSeq, log, lifecycle, ...table } = state;
  const life = { ...lifecycle };
  if (!life.paused) {
    delete life.remainingMs;
    delete life.reviewRemainingMs;
    delete life.collectionRemainingMs;
  }
  return JSON.stringify([context, table, life]);
}

/** Update selection without replacing the hand, focused card or submit button. */
export function updateHandSelection(root, { id, card, label, faceHTML, reason, pending }) {
  const hand = root.querySelector('.hand');
  for (const node of hand?.querySelectorAll('[data-card]') || []) {
    const selected = node.dataset.card === id;
    if (node.classList.contains('selected') === selected) continue;
    node.classList.toggle('selected', selected);
    node.setAttribute('aria-pressed', String(selected));
    const text = node.getAttribute('aria-label').replace(/，已选中$/, '');
    node.setAttribute('aria-label', text + (selected ? '，已选中' : ''));
  }
  const preview = root.querySelector('.selected-preview');
  if (preview) {
    const key = JSON.stringify([id, reason]);
    if (preview.dataset.selection !== key) {
      preview.dataset.selection = key;
      preview.innerHTML = card ? faceHTML(card) : '';
      if (card) {
        const text = document.createElement('span'); text.textContent = `已选 ${label}`; preview.append(text);
        if (reason) { const hint = document.createElement('small'); hint.textContent = reason; preview.append(hint); }
      }
    }
    preview.hidden = !card;
  }
  const hover = root.querySelector('.hover-preview');
  if (hover) hover.hidden = true;
  const button = root.querySelector('#confirm-play');
  if (button) {
    button.disabled = !card || !!reason;
    const title = reason || (card ? `打出 ${label}` : '请先选择手牌');
    if (button.title !== title) button.title = title;
    const text = pending ? '正在提交…' : '出牌';
    if (button.textContent !== text) button.textContent = text;
    const busy = String(!!pending);
    if (button.parentElement.dataset.submitting !== busy) button.parentElement.dataset.submitting = busy;
    if (button.parentElement.getAttribute('aria-busy') !== busy) button.parentElement.setAttribute('aria-busy', busy);
  }
}

/** Move existing keyed cards; retain listeners and focus during sorting. */
export function reorderHand(hand, ids) {
  if (!hand) return;
  const focus = hand.contains(document.activeElement) ? document.activeElement : null;
  const nodes = new Map([...hand.querySelectorAll('[data-card]')].map(node => [node.dataset.card, node]));
  ids.forEach((id, index) => {
    const node = nodes.get(id);
    if (node && hand.children[index] !== node) hand.insertBefore(node, hand.children[index] || null);
  });
  focus?.focus({ preventScroll:true });
}
