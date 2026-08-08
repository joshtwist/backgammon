import { BAR, OFF } from "../shared/types.ts";
import type { BoardState, Color, DicePair, Move } from "../shared/types.ts";
import { applyMoves, mirror, other, pipCount } from "../shared/engine/board.ts";
import { enumerateTurns } from "../shared/engine/moves.ts";

/**
 * The computer opponent's move selection.
 *
 * Pure and synchronous: enumerate every legal complete turn, score the
 * resulting position, play the best one. A single-ply static evaluation —
 * no lookahead over the opponent's reply — which is enough for a decent
 * casual game and easy to deepen later.
 *
 * This is also the seam for the LLM upgrade: swap the scoring step for a
 * model that picks from `enumerateTurns` and keep `pickTurn` as the
 * fallback. Whatever chooses, the result still goes through `validateTurn`
 * in `confirmTurn`, so an illegal turn can never reach the board.
 */

/** Weights, in "pips" so everything trades off against raw race progress. */
const W = {
  /** Sending an opponent checker back — scaled by how far it must re-travel. */
  hit: 1.1,
  /** Owning a point (2+ checkers) — blocks the opponent. */
  point: 3,
  /** Home-board points are worth more (they build a blocking prime). */
  homePoint: 5,
  /** The bar point (7) specifically is prime real estate. */
  barPoint: 4,
  /** Leaving a lone checker exposed, scaled by how easily it's hit. */
  blot: 1.4,
  /** Getting checkers off is the whole point once you're racing. */
  borneOff: 12,
  /** Sitting on the bar is terrible. */
  onBar: 12,
  /** Stacking 4+ on one point wastes checkers. */
  stack: 0.7,
} as const;

/**
 * Rough chance (out of 36) that a blot `distance` pips away gets hit by a
 * direct or common indirect shot. Direct shots (1-6) are far more likely
 * than indirect ones, and beyond 12 it's negligible.
 */
const SHOT_ODDS: Record<number, number> = {
  1: 11, 2: 12, 3: 14, 4: 15, 5: 15, 6: 17,
  7: 6, 8: 6, 9: 5, 10: 3, 11: 2, 12: 3,
};

function shotRisk(distance: number): number {
  return (SHOT_ODDS[distance] ?? 0) / 36;
}

/**
 * Static evaluation of `board` from `color`'s point of view, in pips.
 * Higher is better.
 */
export function evaluate(board: BoardState, color: Color): number {
  const foe = other(color);
  const own = board[color];
  const opp = board[foe];

  // Race: fewer pips than the opponent is good.
  let score = pipCount(board, foe) - pipCount(board, color);

  score += own[OFF] * W.borneOff;
  score -= own[BAR] * W.onBar;
  score += opp[BAR] * W.onBar * 0.8;

  // Is the opponent still in contact? Once the race is disengaged,
  // structure stops mattering and only speed counts.
  const contact = inContact(board, color);

  for (let p = 1; p <= 24; p++) {
    const count = own[p];
    if (count === 0) continue;

    if (count >= 2 && contact) {
      score += p <= 6 ? W.homePoint : p === 7 ? W.barPoint : W.point;
      // Burying checkers on a deep stack is wasteful.
      if (count > 3) score -= (count - 3) * W.stack;
    }

    if (count === 1 && contact) {
      // Distance from the nearest opponent checker that could hit it,
      // i.e. one that's "behind" this point in their direction of travel.
      const distance = nearestAttackerDistance(board, color, p);
      if (distance > 0) score -= shotRisk(distance) * W.blot * 25;
    }
  }

  return score;
}

/** True while either side still has a checker behind an enemy checker. */
function inContact(board: BoardState, color: Color): boolean {
  const own = board[color];
  const opp = board[other(color)];
  if (own[BAR] > 0 || opp[BAR] > 0) return true;

  // My highest point vs the opponent's highest, compared in my numbering.
  let myHighest = 0;
  for (let p = 24; p >= 1; p--) {
    if (own[p] > 0) {
      myHighest = p;
      break;
    }
  }
  let oppHighestInMine = 25;
  for (let p = 24; p >= 1; p--) {
    if (opp[p] > 0) {
      oppHighestInMine = mirror(p);
      break;
    }
  }
  // Contact remains while my rearmost checker is still ahead of theirs.
  return myHighest > oppHighestInMine;
}

/**
 * How far the nearest opponent checker is from my blot on point `p`
 * (in their pips), or 0 when nothing can reach it.
 */
function nearestAttackerDistance(
  board: BoardState,
  color: Color,
  p: number,
): number {
  const opp = board[other(color)];
  // My point p is their point 25-p. They move downward in their own
  // numbering, so attackers sit on higher-numbered points than 25-p —
  // plus anything on the bar (which enters from 25).
  const theirPoint = mirror(p);
  if (opp[BAR] > 0) return 25 - theirPoint;
  for (let q = theirPoint + 1; q <= 24; q++) {
    if (opp[q] > 0) return q - theirPoint;
  }
  return 0;
}

/** How much material this turn sends back, weighted by re-entry distance. */
function hitValue(before: BoardState, after: BoardState, color: Color): number {
  const foe = other(color);
  const hits = after[foe][BAR] - before[foe][BAR];
  if (hits <= 0) return 0;
  // A checker sent back from deep in my home board loses the most ground.
  return hits * 25 * W.hit;
}

/**
 * Choose the turn to play. Returns a legal, maximal move sequence (empty
 * on a dance). Deterministic: ties break toward the first sequence
 * `enumerateTurns` produced, which is stable for a given position.
 */
export function pickTurn(
  board: BoardState,
  color: Color,
  dice: DicePair,
): Move[] {
  const turns = enumerateTurns(board, color, dice);
  if (turns.length <= 1) return turns[0] ?? [];

  let best = turns[0];
  let bestScore = -Infinity;

  for (const turn of turns) {
    const after = applyMoves(board, color, turn);
    const score = evaluate(after, color) + hitValue(board, after, color);
    if (score > bestScore) {
      bestScore = score;
      best = turn;
    }
  }

  return best;
}
