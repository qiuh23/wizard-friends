import { RULE_CHOICES } from './rules-options.js';

export const RULE_LABELS = {
  deckMode: { title: '牌库', values: { standard: '标准牌库', mono: '单色牌库' }, hint: '单色限 3–4 人，每人独立牌库，首轮 4 张，此后递增。' },
  predictionMode: { title: '预估方式', values: { public: '公开预估', hidden: '隐藏预估', secret: '秘密数字' }, hint: '公开：依次报数。隐藏：全部提交后公开。秘密：本轮结束才公开。' },
  strict: { title: '加减预估', values: { false: '关闭', true: '开启' }, hint: '仅适用于公开预估；最后一人须避开总和等于本轮墩数。' },
  foresight: { title: '先见之明', values: { false: '关闭', true: '开启' }, hint: '开启后每轮预估时看别人的整手牌，不看自己的牌；全员预估完再揭开。' },
  short: { title: '局长', values: { false: '完整局', true: '快速局 · 5 轮' }, hint: '标准完整局 10–20 轮，单色完整局 12 轮。' },
};
export function ruleSummary(options) {
  return [RULE_LABELS.deckMode.values[options.deckMode], RULE_LABELS.predictionMode.values[options.predictionMode],
    ...(options.strict ? ['加减预估'] : []), ...(options.foresight ? ['先见之明'] : []), RULE_LABELS.short.values[options.short]].join(' · ');
}
export function ruleSetupHTML(state, isHost) {
  return `<section class="rules-setup" aria-labelledby="setup-title"><div class="setup-heading"><h2 id="setup-title">整局玩法</h2><span>${isHost ? '房主选择' : '由房主选择'}</span></div>
    <p>在开始游戏前选好，之后每轮沿用。首墩由庄家左手边首攻，之后由上一墩赢家先出；公开预估也从庄家左手边开始。</p>
    <form id="rules-form"><div class="rule-groups">${Object.entries(RULE_CHOICES).map(([key, values]) => `<fieldset><legend>${RULE_LABELS[key].title}</legend><div class="rule-choices">${values.map(value => {
      const unavailable = (key === 'deckMode' && value === 'mono' && state.players.length > 4) || (key === 'strict' && state.options.predictionMode !== 'public');
      return `<label><input type="radio" name="${key}" value="${value}" ${state.options[key] === value ? 'checked' : ''} ${!isHost || unavailable ? 'disabled' : ''}><span>${RULE_LABELS[key].values[value]}</span></label>`;
    }).join('')}</div><p>${RULE_LABELS[key].hint}</p></fieldset>`).join('')}</div></form></section>`;
}
