/**
 * Impatience GIFs, shown when the roller sits on their hands for 5+
 * seconds. IDs pulled from giphy's "impatient" search. Preloaded once
 * per session so the popup is instant.
 */
export const IMPATIENT_GIFS: string[] = [
  "https://i.giphy.com/media/Emg9qPKR5hquI/giphy.gif",
  "https://i.giphy.com/media/JzOyy8vKMCwvK/giphy.gif",
  "https://i.giphy.com/media/qSYeGGz7DtDEo9Htk0/giphy.gif",
  "https://i.giphy.com/media/yFWrsZIPyTwzI7c24x/giphy.gif",
  "https://i.giphy.com/media/QVs6OmwbbGvWPJJ75m/giphy.gif",
  "https://i.giphy.com/media/l0HlBO7eyXzSZkJri/giphy.gif",
  "https://i.giphy.com/media/hCiQVo1dzVwPu/giphy.gif",
  "https://i.giphy.com/media/M5zhoj9rhwkhy/giphy.gif",
  "https://i.giphy.com/media/26n6xBpxNXExDfuKc/giphy.gif",
  "https://i.giphy.com/media/8TT8VjZTZGWQw/giphy.gif",
  "https://i.giphy.com/media/PWfHC8ogZpWcE/giphy.gif",
  "https://i.giphy.com/media/tXL4FHPSnVJ0A/giphy.gif",
];

let preloaded = false;

export function preloadImpatientGifs(): void {
  if (preloaded) return;
  preloaded = true;
  try {
    for (const url of IMPATIENT_GIFS) {
      const img = new Image();
      img.src = url;
    }
  } catch {
    // Never let a warm-up failure hurt the game.
  }
}

export function randomImpatientGif(): string {
  return IMPATIENT_GIFS[Math.floor(Math.random() * IMPATIENT_GIFS.length)];
}
