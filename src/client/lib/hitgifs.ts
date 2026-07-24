/**
 * Reaction GIFs shown to the player who just got hit onto the bar.
 * One hit → a "damn" GIF; two or more in a single turn → "I'm dead".
 * IDs scraped from giphy's "damn" and "I'm-dead" searches.
 */

const gif = (id: string) => `https://i.giphy.com/media/${id}/giphy.gif`;

export const DAMN_GIFS: string[] = [
  "twxoPjMpsijwPFBVqs",
  "t9ctG5MZhyyU8",
  "RT5lVEasnOBBnzOIEw",
  "cF7QqO5DYdft6",
  "voOhKPgzYsyPu",
  "YnlJLeR4C9vACPZhil",
  "KOobSqJrq9lA2ypra6",
  "KWRjfFe4x7nwyh9GlX",
  "0dz9Ri1GCMc0HnTNnN",
  "ka6M66Z58QEcXadCd4",
  "LoIsP3fz02IjOUTc6t",
  "ubVkxdi7qNCwNaw8VY",
].map(gif);

export const DEAD_GIFS: string[] = [
  "12tvyiuV6LljSm7quL",
  "Vu8nIaC6rSVi",
  "8x8XzoP8qQa4w",
  "VN3dGsdlp9nCPUfe8y",
  "12tVVnJSacDXby",
  "95ThFF7MokcdeoVqt8",
  "eBCnpuRGBhQGY",
  "Z5ULYTFVaL2Ok",
  "99kszlXr46Jkk3C5CJ",
  "ze4Y13PeotDfqoQWza",
  "bhD0kyBdLyJaX4gB11",
  "E4VZ8rzhueRz86REGp",
].map(gif);

let preloaded = false;

export function preloadHitGifs(): void {
  if (preloaded) return;
  preloaded = true;
  try {
    for (const url of [...DAMN_GIFS, ...DEAD_GIFS]) {
      const img = new Image();
      img.src = url;
    }
  } catch {
    /* never let a warm-up failure hurt the game */
  }
}

/** A random reaction GIF for `hits` checkers sent to the bar this turn. */
export function reactionGif(hits: number): string {
  const pool = hits >= 2 ? DEAD_GIFS : DAMN_GIFS;
  return pool[Math.floor(Math.random() * pool.length)];
}
