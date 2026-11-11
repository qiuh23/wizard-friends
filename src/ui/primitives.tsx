import { useEffect, type CSSProperties, type ButtonHTMLAttributes } from 'react';
import { icon } from '../ui-icons.js';
import { cardImage, loadCardImage } from '../card-art.js';
import { cardMark } from '../card-face.js';
import { SUIT_NAMES } from '../game.js';
import type { CardView } from './types';

// The only HTML bridge is the existing, closed vocabulary of static SVG paths.
export function Icon({name}: {name: string}) {
  return <span className="icon-fragment" aria-hidden="true" dangerouslySetInnerHTML={{__html: icon(name)}} />;
}
export function IconButton({name, label, children, ...props}: ButtonHTMLAttributes<HTMLButtonElement> & {name: string; label: string}) {
  return <button type="button" {...props} className={`table-icon-button ${props.className || ''}`} aria-label={label} title={props.title || label}>
    <Icon name={name}/>{children && <span className="control-label">{children}</span>}
  </button>;
}
export function cardLabel(card: CardView) {
  return card.kind === 'wizard' ? '巫师 W' : card.kind === 'jester' ? '小丑 J' : `${SUIT_NAMES[card.suit!].split(' · ')[0]} ${card.rank}`;
}
export function Card({card, inspectable = false, legal = false, selected = false}: {card: CardView; inspectable?: boolean; legal?: boolean; selected?: boolean}) {
  const mark = cardMark(card);
  useEffect(() => { void loadCardImage(card).catch(() => {}); }, [card.kind, card.suit, card.rank]);
  const identity = inspectable ? {'data-card': card.id, 'aria-pressed': selected} : {'data-visible-card': card.id};
  return <button type="button" {...identity} className={`card ${card.suit || card.kind} ${legal ? 'playable' : ''} ${selected ? 'selected' : ''}`}
    style={{'--card-color': mark.color, backgroundImage: `url('${cardImage(card)}')`} as CSSProperties}
    disabled={!inspectable} tabIndex={inspectable ? undefined : -1}
    aria-label={`${cardLabel(card)}${legal ? '，合法牌' : ''}${selected ? '，已选中' : ''}`} title={`${mark.name} ${mark.value}`}>
    <span className="corner"><span className="card-value">{mark.value}</span><small>{mark.symbol}</small></span>
    {card.kind === 'number' && <span className="suit-mark" aria-hidden="true">{mark.symbol}</span>}
  </button>;
}
