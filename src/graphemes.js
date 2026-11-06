// Segment once per name, never by UTF-16 code unit. The fallback covers
// combining marks, variation selectors, emoji modifiers, ZWJ chains and flags.
const segmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined, {granularity:'grapheme'}) : null;
const extendsCluster = /[\p{Mark}\p{Emoji_Modifier}\u{E0020}-\u{E007F}]/u;
const regional = /\p{Regional_Indicator}/u;
export function fallbackGraphemes(value) {
  const result=[]; let previous='', regionalCount=0;
  for(const point of String(value ?? '')) {
    const join=result.length && (extendsCluster.test(point) || point==='\u200d' || previous==='\u200d' || previous==='\r' && point==='\n' || regional.test(point) && regionalCount%2===1);
    if(join)result[result.length-1]+=point;else result.push(point);
    regionalCount=regional.test(point)?regionalCount+1:0; previous=point;
  }
  return result;
}
export function graphemes(value) {
  return segmenter ? Array.from(segmenter.segment(String(value ?? '')), item=>item.segment) : fallbackGraphemes(value);
}
export const avatarCharacter = name => graphemes(name)[0] || '✧';
export const shortName = (name, count=2) => graphemes(name).slice(0,count).join('');
