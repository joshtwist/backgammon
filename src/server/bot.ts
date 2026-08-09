import { BAR, OFF } from "../shared/types.ts";
import type {
  BoardState,
  BotDifficulty,
  Color,
  DicePair,
  Move,
} from "../shared/types.ts";
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

/** Score one candidate turn by the static evaluation (single ply). */
function scoreTurn(board: BoardState, color: Color, turn: Move[]): number {
  const after = applyMoves(board, color, turn);
  return evaluate(after, color) + hitValue(board, after, color);
}

/** Candidates ranked best-first by the static evaluation. */
function rankTurns(
  board: BoardState,
  color: Color,
  turns: Move[][],
): { turn: Move[]; score: number }[] {
  return turns
    .map((turn) => ({ turn, score: scoreTurn(board, color, turn) }))
    .sort((a, b) => b.score - a.score);
}

/**
 * The 21 distinct rolls of two dice, with their probability. Doubles come
 * up one way in 36, every other combination two ways.
 */
const ALL_ROLLS: { dice: DicePair; p: number }[] = (() => {
  const rolls: { dice: DicePair; p: number }[] = [];
  for (let a = 1; a <= 6; a++) {
    for (let b = a; b <= 6; b++) {
      rolls.push({ dice: [a, b] as DicePair, p: (a === b ? 1 : 2) / 36 });
    }
  }
  return rolls;
})();

/** How many top candidates get the (much costlier) two-ply treatment. */
const TWO_PLY_WIDTH = 8;

/**
 * Two-ply evaluation: play `turn`, then for each of the opponent's 21
 * possible rolls assume they answer with their best single-ply reply, and
 * average the resulting position (from our side) weighted by how likely
 * each roll is.
 *
 * This is what lets Hard avoid blots that specifically get punished — a
 * single-ply bot can't see the return shot at all, it only knows the
 * generic blot penalty.
 */
function twoPlyScore(board: BoardState, color: Color, turn: Move[]): number {
  const after = applyMoves(board, color, turn);
  const foe = other(color);

  let total = 0;
  for (const { dice, p } of ALL_ROLLS) {
    const replies = enumerateTurns(after, foe, dice);
    let worst = Infinity; // worst for us = best for them
    for (const reply of replies) {
      const resulting = applyMoves(after, foe, reply);
      const ourScore = evaluate(resulting, color) - hitValue(after, resulting, foe);
      if (ourScore < worst) worst = ourScore;
    }
    total += p * (worst === Infinity ? evaluate(after, color) : worst);
  }
  return total;
}

export interface PickOptions {
  difficulty?: BotDifficulty;
  /** Injectable for deterministic tests; defaults to Math.random. */
  random?: () => number;
}

/**
 * How often each difficulty throws away the best play and picks a random
 * legal one instead — the "missed option" a human makes.
 */
const SLIP_CHANCE: Record<BotDifficulty, number> = {
  easy: 0.45,
  medium: 0.12,
  hard: 0,
};

/**
 * Choose the turn to play. Returns a legal, maximal move sequence (empty
 * on a dance) — always legal at every difficulty; weaker settings pick a
 * worse legal turn, never an invalid one.
 *
 * Deterministic on hard (and on medium/easy given a fixed `random`).
 */
export function pickTurn(
  board: BoardState,
  color: Color,
  dice: DicePair,
  options: PickOptions = {},
): Move[] {
  const difficulty = options.difficulty ?? "medium";
  const random = options.random ?? Math.random;

  const turns = enumerateTurns(board, color, dice);
  if (turns.length <= 1) return turns[0] ?? [];

  // The slip: play a random legal turn instead of thinking. This is what
  // makes easy beatable — it still never plays illegally, it just misses.
  const slip = SLIP_CHANCE[difficulty];
  if (slip > 0 && random() < slip) {
    return turns[Math.floor(random() * turns.length)] ?? turns[0];
  }

  const ranked = rankTurns(board, color, turns);

  if (difficulty !== "hard") return ranked[0].turn;

  // Hard: re-score the most promising candidates a move deeper. Narrowing
  // to the top few first keeps this well inside a few hundred ms even on
  // doubles, where the candidate list gets long.
  const shortlist = ranked.slice(0, TWO_PLY_WIDTH);
  let best = shortlist[0].turn;
  let bestScore = -Infinity;
  for (const { turn } of shortlist) {
    const score = twoPlyScore(board, color, turn);
    if (score > bestScore) {
      bestScore = score;
      best = turn;
    }
  }
  return best;
}
