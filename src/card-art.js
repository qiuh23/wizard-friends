// Shared by HTML hands, the 2D trump card and WebGL textures.
// Vite emits separate, hashed assets; the four copies of each special share art.
export function cardImage(card) {
  const artwork = card.kind === 'number'
    ? `${card.suit}-${String(card.rank).padStart(2, '0')}`
    : card.kind;
  return new URL(`./assets/cards/${artwork}.svg`, import.meta.url).href;
}

const imageLoads = new Map();
const decodedImages = new Map();
// A promise alone cannot supply the first synchronous WebGL frame.
export function loadedCardImage(card) { return decodedImages.get(cardImage(card)) || null; }

// HTML cards and physical faces share one decoded image per illustration.
export function loadCardImage(card) {
  const url = cardImage(card);
  if (!imageLoads.has(url)) {
    const request = new Promise((resolve, reject) => {
      const image = new Image();
      image.decoding = 'async';
      image.onload = async () => {
        try {
          await image.decode(); decodedImages.set(url, image); resolve(image);
        } catch (error) { reject(error); }
      };
      image.onerror = () => reject(new Error('牌面插画加载失败。'));
      image.src = url;
    }).catch(error => { imageLoads.delete(url); throw error; });
    imageLoads.set(url, request);
  }
  return imageLoads.get(url);
}
