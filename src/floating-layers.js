// Resolve panels and triggers for each event: table renders replace controls,
// while chat keeps its DOM and input focus.
export function containsEvent(event, nodes) {
  const path = event.composedPath?.() || [];
  return nodes.some(node => node && (path.includes(node) || node.contains?.(event.target)));
}

export class FloatingLayers {
  constructor(layers, { blocked = () => false, ignoreClick = () => false } = {}) {
    this.layers = layers;
    this.blocked = blocked;
    this.ignoreClick = ignoreClick;
  }
  closeOthers(id, { restoreFocus = false } = {}) {
    const open = this.layers.filter(layer => layer.id !== id && layer.isOpen());
    for (const [index, layer] of open.entries()) layer.close({ restoreFocus:restoreFocus && index === open.length - 1 });
    return open.length > 0;
  }
  click(event) {
    if (event.button !== 0 || this.blocked() || this.ignoreClick(event)) return;
    const owner = this.layers.find(layer => layer.contains(event));
    this.closeOthers(owner?.id);
  }
  keydown(event) {
    if (event.key !== 'Escape' || event.defaultPrevented || this.blocked()) return;
    if (this.closeOthers(null, { restoreFocus:true })) event.preventDefault();
  }
  listen(document) {
    // Dismiss before a clicked control can redraw/detach its target; leave its
    // normal action and propagation intact.
    document.addEventListener('click', event => this.click(event), true);
    document.addEventListener('keydown', event => this.keydown(event));
  }
}
