// Keep edge props inside the same CSS safe-area padding as the playable table.
// Input is CSS pixels from the actual table; do not infer a particular phone.
export function decorationViewport(width, height, padding = {}) {
  const inset = (value, limit) => Math.min(limit * .25, Math.max(0, parseFloat(value) || 0));
  const left = inset(padding.paddingLeft, width), right = inset(padding.paddingRight, width);
  const top = inset(padding.paddingTop, height), bottom = inset(padding.paddingBottom, height);
  return { x: value => (left + value * (width - left - right)) / width,
    y: value => (top + value * (height - top - bottom)) / height };
}
