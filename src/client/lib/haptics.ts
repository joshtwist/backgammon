function vibrate(pattern: number | number[]): void {
  try {
    navigator?.vibrate?.(pattern);
  } catch {
    // Vibration API not available - silent no-op
  }
}

/** 50ms pulse - move confirm / dice roll */
export function vibrateAction(): void {
  vibrate(50);
}

/** 200ms pulse - your turn alert */
export function vibrateTurn(): void {
  vibrate(200);
}

/** Celebration pattern - win */
export function vibrateWin(): void {
  vibrate([100, 50, 100, 50, 200]);
}

/** Double-buzz - rejection/error */
export function vibrateError(): void {
  vibrate([50, 30, 50]);
}

/** Sharp triple tap - a blot was hit */
export function vibrateHit(): void {
  vibrate([30, 30, 30, 30, 80]);
}
