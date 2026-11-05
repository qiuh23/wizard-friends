const ids = new Set(['cloudflare', 'aliyun']);
const prefixes = { cloudflare: 'C', aliyun: 'A' };
let runtime;

export function exactAllowedOrigins(value = '') {
  return String(value).split(',').map(item => item.trim()).filter(Boolean).map(item => {
    const url = new URL(item);
    if (!['https:', 'http:'].includes(url.protocol) || url.origin !== item || url.username || url.password || url.hostname.includes('*')) throw new Error('ALLOWED_ORIGINS must contain exact HTTP(S) origins.');
    return item;
  });
}

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
  const response = await fetcher(new URL('runtime-config.json', location.href), { cache: 'no-store', credentials: 'same-origin', redirect: 'error', signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error('入口配置暂不可用，请刷新重试。');
  runtime = normalizeRuntimeConfig(await response.json(), location.origin);
  return runtime;
}
export function runtimeConfig() { return runtime; }
export function backendId() { return runtime?.backendId || 'cloudflare'; }
// Keep ordinary navigation free of invitation parameters. The lobby's own
// origin selects its line, independently of any remembered preference.
export function gameLobbyURL(currentBackend = backendId()) {
  if (!ids.has(currentBackend)) return null;
  const address = { aliyun: 'https://magical-athlete-online.cn/', cloudflare: 'https://magical-athlete.qiuh23.workers.dev/lobby/' }[currentBackend];
  return address || null;
}
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
export function readInvitation(search, currentBackend = backendId()) {
  const params = new URLSearchParams(search);
  if (!params.has('room')) return null;
  for (const key of ['room', 'server', 'game', 'watch']) {
    if (params.getAll(key).length > 1) throw new Error('邀请链接包含重复参数，请使用完整的原邀请。');
  }
  if (params.has('game') && params.get('game') !== 'wizard') throw new Error('此邀请不属于巫师牌，请使用原游戏入口。');
  const explicitServer = params.get('server');
  if (params.has('server') && !ids.has(explicitServer)) throw new Error('邀请中的服务器无效，请使用完整的原邀请。');
  const invite = parseRoomCode(params.get('room'), explicitServer || currentBackend);
  if (!invite) throw new Error('邀请房间码无效，请使用完整的原邀请。');
  if (explicitServer && invite.backendId !== explicitServer) throw new Error('邀请中的服务器与房间码不一致，请使用完整的原邀请。');
  if (params.has('watch') && !['0', '1'].includes(params.get('watch'))) throw new Error('邀请中的观战状态无效，请使用完整的原邀请。');
  return { ...invite, watch: params.get('watch') === '1' };
}
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
  const invite = readInvitation(location.search, config?.backendId);
  if (hasCurrentRoom || !invite || invite.backendId === config?.backendId) return null;
  const target = entryURL(invite.backendId, invite, config);
  if (!target) throw new Error('该邀请所属服务器暂未开放，请联系邀请人确认原入口；不会跨服查找房间。');
  return target;
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
