// Trusted deployment policy. Room/client payloads never select this value.
export const CN_NICKNAMES = Object.freeze([
  '天狼星','北极星','织女星','牛郎星','大角星','晨星','参宿四','参宿七',
  '天枢','天璇','天玑','天权','玉衡','开阳','摇光','北落师门',
  '猎户座','天琴座','天鹅座','仙女座','英仙座','飞马座','天鹰座','海豚座',
  '昴星团','银河','极光','流星','彗星','日冕','光年','月海',
]);
export const COMMUNICATION_DISABLED = '当前站点不提供玩家交流功能。';
export const FOREIGN_INVITATION = '此邀请不属于当前站点，请向房主确认原始邀请链接。';
export function normalizeEdition(value) {
  if (!['cn', 'global'].includes(value)) throw Error('SITE_EDITION 必须明确配置为 cn 或 global。');
  return value;
}
export function serverEdition(env = {}) {
  if (env.SITE_EDITION != null) return normalizeEdition(env.SITE_EDITION);
  if (env.NODE_ENV === 'production') return normalizeEdition(undefined);
  return 'global'; // Local engine/adapter compatibility only; deployed Worker declares SITE_EDITION.
}
export const nicknameId = index => `wizard-cn-${String(index + 1).padStart(2, '0')}`;
export function nicknameFromId(id) {
  const index = CN_NICKNAMES.findIndex((_, index) => nicknameId(index) === id);
  return index < 0 ? null : CN_NICKNAMES[index];
}
export function randomNicknameId() {
  return nicknameId(crypto.getRandomValues(new Uint32Array(1))[0] % CN_NICKNAMES.length);
}
export function assignNickname(member, members = [], preferred) {
  if (preferred != null && !nicknameFromId(preferred)) throw Error('昵称编号无效，请重新选择。');
  const others = members.filter(other => other !== member);
  const counts = CN_NICKNAMES.map((_, i) => others.filter(other => other.nicknameId === nicknameId(i)).length);
  const free = counts.flatMap((count, i) => count === 0 ? [nicknameId(i)] : []);
  const choices = free.length ? free : counts.flatMap((count, i) => count === Math.min(...counts) ? [nicknameId(i)] : []);
  const id = preferred && choices.includes(preferred) ? preferred : choices[crypto.getRandomValues(new Uint32Array(1))[0] % choices.length];
  member.nicknameId = id; member.name = nicknameFromId(id); member.automaticName = true;
  const badges = new Set(others.filter(other => other.nicknameId === id).map(other => other.nicknameBadge || 1));
  let badge = 1; while (badges.has(badge)) badge++;
  member.nicknameBadge = badge;
  return member;
}
export function communicationRequest(message) {
  const value = message?.type === 'send' ? message.data : message;
  const action = value?.type === 'action' ? value.action : value;
  return ['chat','message','phrase','emoji','reaction','quickChat','quick-chat','send-chat','send-phrase','send-emoji'].includes(action?.type) ||
    !!action && ['phraseId','emojiId','text','message'].some(key => Object.hasOwn(action, key));
}
export function enforceRequest(edition, message) {
  if (edition !== 'cn') return;
  if (communicationRequest(message)) throw Error(COMMUNICATION_DISABLED);
  const value = message?.type === 'send' ? message.data : message;
  if (value?.action?.type === 'rename' || value?.type === 'rename') throw Error('进入房间后昵称固定。');
}
// Versioned, idempotent migration: game records, hands, scores, IDs and random state stay intact.
export function migrateCNGame(game) {
  game.siteEdition = 'cn';
  game.spectatorNames ||= {};
  const members = [...game.players, ...Object.values(game.spectatorNames)];
  const migrated = game.cnPolicyVersion !== 1 || members.some(member => !nicknameFromId(member.nicknameId));
  for (const member of members) {
    if (!nicknameFromId(member.nicknameId)) assignNickname(member, members);
    else { member.name = nicknameFromId(member.nicknameId); member.automaticName = true; member.nicknameBadge ||= 1; }
  }
  // Legacy free text lacks reliable actor/event metadata; retain structured legal records.
  if (migrated) { game.log = []; game.publicEvents = []; }
  game.chat = []; game.chatSeq = 0; game.cnPolicyVersion = 1;
  return game;
}
