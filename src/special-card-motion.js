// Presentation only: these poses never mutate the deal, trick or winner.
export const SPECIAL_CARD_ENTER_MS = 1120;
export const isSpecialCard = card => ['wizard', 'jester'].includes(card?.kind);
const clamp = value => Math.max(0, Math.min(1, value));
const smooth = value => value * value * (3 - 2 * value);

export function specialCardPose(kind, elapsed = Infinity, collect = 0, reduced = false) {
  // Let the card touch the felt first. Then the miniature rises out of its art,
  // jumps to the felt just beyond the top edge, and settles without an idle loop.
  const progress = reduced ? 1 : clamp((elapsed - 270) / 720);
  const travel = smooth(progress);
  const settle = reduced ? 0 : Math.sin(clamp((elapsed - 990) / 130) * Math.PI) * .12;
  const departure = reduced ? 1 : 1 - smooth(clamp(collect / .22));
  const scale = (progress === 1 ? 1 : smooth(clamp(progress / .24))) * departure;
  return { x: 0, y: 4 * progress * (1 - progress) * .52,
    z: -.94 * travel, scale, squash: 1 - settle,
    turn: kind === 'jester' ? Math.PI * 2 * travel : Math.sin(progress * Math.PI) * -.4,
    active: !reduced && elapsed < SPECIAL_CARD_ENTER_MS && collect === 0,
    visible: scale > .001 && collect < .22 };
}
