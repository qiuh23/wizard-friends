const ids = new Set(['cloudflare', 'aliyun']);
const prefixes = { cloudflare: 'C', aliyun: 'A' };
let runtime;

export function normalizeRuntimeConfig(value, currentOrigin) {
  if (!value || !ids.has(value.backendId) || !Array.isArray(value.backends)) throw new Error('入口配置无效。');
  const seen = new Set();
  const backends = value.backends.map(item => {
    if (!item || !ids.has(item.id) || seen.has(item.id) || typeof item.origin !== 'string' || typeof item.enabled !== 'boolean') throw new Error('入口配置无效。');
    seen.add(item.id);
    const url = new URL(item.origin || currentOrigin);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('入口地址无效。');
    return { id: item.id, origin: url.origin, enabled: item.enabled };
  });
  if (!seen.has(value.backendId)) throw new Error('缺少当前入口配置。');
  // null preserves the optional legacy Pages relay. Empty explicitly selects
  // this deployment, including when the build contains a fixed Cloudflare URL.
  if (value.relayOrigin != null && value.relayOrigin !== '') throw new Error('房间服务必须使用当前入口。');
  return { backendId: value.backendId, relayOrigin: value.relayOrigin, backends };
}

export async function loadRuntimeConfig({ fetcher = globalThis.fetch, location = globalThis.location } = {}) {
  const response = await fetcher(new URL('runtime-config.json', location.href), { cache: 'no-store', credentials: 'same-origin' });
  if (!response.ok) throw new Error('入口配置暂不可用，请刷新重试。');
  runtime = normalizeRuntimeConfig(await response.json(), location.origin);
  return runtime;
}
export function runtimeConfig() { return runtime; }
export function backendId() { return runtime?.backendId || 'cloudflare'; }
export function relayOrigin(legacy, location = globalThis.location) {
  const base = runtime?.relayOrigin === '' ? location.origin : legacy || location.origin;
  const url = new URL(base);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || (location?.protocol === 'https:' && url.protocol !== 'https:')) throw new Error('房间服务地址与当前入口协议不兼容。');
  return url.origin;
}
export function parseRoomCode(value, currentBackend = backendId()) {
  const match = /^(?:([CA])-)?([A-Z2-9]{8})$/.exec(String(value || '').trim().toUpperCase());
  if (!match) return null;
  return { backendId: match[1] === 'C' ? 'cloudflare' : match[1] === 'A' ? 'aliyun' : currentBackend, room: match[2] };
}
export function publicRoomCode(room, currentBackend = backendId()) { return `${prefixes[currentBackend]}-${room}`; }
export function invitationURL(room, watch = false, location = globalThis.location, currentBackend = backendId()) {
  if (!/^[A-Z2-9]{8}$/.test(room) || !ids.has(currentBackend)) throw new Error('房间码无效。');
  const url = new URL(location.pathname, location.origin);
  url.searchParams.set('room', publicRoomCode(room, currentBackend));
  if (watch) url.searchParams.set('watch', '1');
  return url.href;
}
export function entryURL(target, { room = '', watch = false } = {}, config = runtime) {
  const entry = config?.backends.find(item => item.id === target && item.enabled);
  if (!entry) return null;
  const url = new URL('/', entry.origin);
  if (room) {
    if (!/^[A-Z2-9]{8}$/.test(room)) return null;
    url.searchParams.set('room', publicRoomCode(room, target));
    if (watch) url.searchParams.set('watch', '1');
  }
  return url.href;
}
export function invitationRedirect(location, hasCurrentRoom, config = runtime) {
  const params = new URLSearchParams(location.search);
  const invite = parseRoomCode(params.get('room'), config?.backendId);
  if (hasCurrentRoom || !invite || invite.backendId === config?.backendId) return null;
  return entryURL(invite.backendId, { room: invite.room, watch: params.get('watch') === '1' }, config);
}
// Origins already isolate real deployments. Also scope by the configured pool
// so changing a local/test origin's runtime cannot reuse another pool's token.
// Cloudflare keeps existing keys to retain old links and recovery credentials.
export function backendStorage(storage, currentBackend = backendId()) {
  const key = value => currentBackend === 'cloudflare' ? value : `${value}:${currentBackend}`;
  return {
    getItem: value => storage.getItem(key(value)),
    setItem: (value, data) => storage.setItem(key(value), data),
    removeItem: value => storage.removeItem(key(value)),
  };
}
