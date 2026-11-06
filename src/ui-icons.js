// One stroke, grid and vocabulary for table controls. Card artwork stays intact.
const paths = {
  back: '<path d="m10 5-7 7 7 7M3 12h18"/>',
  enter: '<path d="M14 3h7v18h-7M3 12h13m-5-5 5 5-5 5"/>',
  chat: '<path d="M20 11a8 8 0 0 1-8 8H5l-3 3V11a9 9 0 0 1 18 0Z"/><path d="M7 10h8M7 14h5"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  scores: '<path d="M5 3h14v18H5zM9 7h6M9 11h6M9 15h2M14 15h1"/>',
  sort: '<path d="M7 4v16m-3-3 3 3 3-3M14 5h6M14 10h4M14 15h2"/>',
  expand: '<rect x="3" y="3" width="7" height="8" rx="1"/><rect x="14" y="3" width="7" height="8" rx="1"/><rect x="3" y="15" width="7" height="6" rx="1"/><rect x="14" y="15" width="7" height="6" rx="1"/>',
  fan: '<path d="m5 19-3-9 6-3m1 13L7 5l7-1m0 16V5l7 1-2 15Z"/>',
  down: '<path d="m5 9 7 7 7-7"/>',
  up: '<path d="m5 15 7-7 7 7"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  play: '<path d="m8 4 12 8-12 8Z"/>',
  target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 1v3m11 8h-3M12 23v-3M1 12h3"/>',
  trophy: '<path d="M7 3h10v6a5 5 0 0 1-10 0ZM7 5H3v3a4 4 0 0 0 4 4m10-7h4v3a4 4 0 0 1-4 4M12 14v6m-4 1h8"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="m7 12 3 3 7-7"/>',
  miss: '<circle cx="12" cy="12" r="9"/><path d="m8 8 8 8m0-8-8 8"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 4v3"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  reconnect: '<path d="M20 9a8 8 0 0 0-14-3L3 9m0-5v5h5m-4 6a8 8 0 0 0 14 3l3-3m0 5v-5h-5"/>',
  close: '<path d="m6 6 12 12m0-12L6 18"/>',
  cards: '<rect x="8" y="4" width="12" height="17" rx="2"/><path d="m5 18-3-13 11-3"/>',
  blue: '<path d="M12 2v20M3 7l18 10M3 17 21 7M9 4l3 3 3-3M9 20l3-3 3 3"/>',
  red: '<path d="M5 3v5h14V3h-4v3H9V3ZM7 8v10m10-10v10M5 18h14v3H5Z"/>',
  green: '<path d="M20 3C8 2 2 8 6 16c7 5 15-1 14-13ZM3 22 16 9M8 17v-5m5 0h5"/>',
  yellow: '<path d="m12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3Z"/>',
  none: '<circle cx="12" cy="12" r="8"/><path d="m5 19 14-14"/>',
};

export function icon(name) {
  return `<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths[name] || paths.cards}</svg>`;
}

export function setIconButton(button, name, label, accessibleName = label) {
  button.classList.add('table-icon-button');
  const content = `${icon(name)}<span class="control-label">${label}</span>`;
  if (button.innerHTML !== content) button.innerHTML = content;
  button.setAttribute('aria-label', accessibleName);
  button.title = accessibleName;
}
