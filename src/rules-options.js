export const DEFAULT_OPTIONS = {
  short: false, strict: false, deckMode: 'standard', predictionMode: 'public', foresight: false,
};
export const RULE_CHOICES = {
  deckMode: ['standard', 'mono'], predictionMode: ['public', 'hidden', 'secret'],
  strict: [false, true], foresight: [false, true], short: [false, true],
};
export function normalizeOptions(options = {}) {
  const result = Object.fromEntries(Object.entries(RULE_CHOICES).map(([key, values]) =>
    [key, values.includes(options?.[key]) ? options[key] : DEFAULT_OPTIONS[key]]));
  if (result.predictionMode !== 'public') result.strict = false;
  return result;
}
export function validateOptions(options, playerCount) {
  if (!options || typeof options !== 'object' || Array.isArray(options) ||
      Object.keys(options).some(key => !Object.hasOwn(RULE_CHOICES, key)) ||
      Object.entries(RULE_CHOICES).some(([key, values]) => !values.includes(options[key]))) {
    throw new Error('请为每项规则选择有效选项。');
  }
  if (options.deckMode === 'mono' && playerCount > 4) throw new Error('单色牌库仅支持 3–4 人，请改用标准牌库。');
  return normalizeOptions(options);
}
