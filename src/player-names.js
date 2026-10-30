// Short everyday nicknames with varied initials for the existing seat avatars.
export const BOT_NAMES = Object.freeze([
  '小林', '阿宁', '老周', '木子', '橙子', '麦子', '石头', '可乐',
  '豆豆', '团子', '果果', '栗子', '桃子', '布丁', '花生', '南瓜',
  '米粒', '圆圆', '皮皮', '大熊', '安安', '乐乐', '晨晨', '暖暖',
  '东东', '西西', '悠悠', '夏夏', '七七', '点点', '贝贝', '冬冬',
]);
const nameKey = name => name.trim().normalize('NFKC').toLowerCase();
const randomValue = () => globalThis.crypto.getRandomValues(new Uint32Array(1))[0] / 0x100000000;

export function validateName(name) {
  if (typeof name !== 'string' || /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(name)) {
    throw new Error('昵称需要 1–16 个字符，不能包含换行或隐藏字符。');
  }
  const normalized = name.trim().normalize('NFC');
  if (!normalized || normalized.length > 16) throw new Error('昵称需要 1–16 个字符。');
  return normalized;
}

export function uniqueBotName(existingNames = [], random = randomValue) {
  const used = new Set(existingNames.map(nameKey));
  const available = BOT_NAMES.filter(name => !used.has(nameKey(name)));
  if (available.length) {
    const initials = new Set([...used].map(name => [...name][0]));
    const distinct = available.filter(name => !initials.has([...name][0]));
    const choices = distinct.length ? distinct : available;
    return choices[Math.floor(random() * choices.length)];
  }
  // Exhaustion never retries random picks or consumes the game's deal stream.
  for (let suffix = 2; suffix <= used.size + 2; suffix++) {
    const name = `牌友${suffix}`;
    if (!used.has(nameKey(name))) return name;
  }
}

export function resolveName(name, existingNames = [], { bot = false, automatic = false } = {}) {
  if (bot && (automatic || typeof name === 'string' && !name.trim())) return uniqueBotName(existingNames);
  const normalized = validateName(name);
  if (!existingNames.some(existing => nameKey(existing) === nameKey(normalized))) return normalized;
  throw new Error('昵称已被使用，请换一个名字。');
}
