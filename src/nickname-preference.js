// Prefer the browser's latest name; migrate manual names from older tabs.
// Room identities and authentication stay in their existing session storage.
export function readNickname(local, session) {
  for (const storage of [local, session]) {
    try {
      const name = storage.getItem('wizard-name');
      if (name !== null && storage.getItem('wizard-name-automatic') !== 'true') return name;
    } catch { /* Preferences are optional; try the other storage. */ }
  }
  return '';
}

export function saveNickname(local, session, name, automatic = false) {
  for (const storage of [local, session]) {
    try {
      storage.setItem('wizard-name', automatic ? '' : name);
      storage.setItem('wizard-name-automatic', String(automatic));
    } catch { /* A blocked preference must not prevent entering a room. */ }
  }
}
