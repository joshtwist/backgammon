import { BAR } from "../types.ts";
import type { BoardState, Color, DicePair, Die, Move } from "../types.ts";
import {
  allInHome,
  applyMove,
  applyMoves,
  highestOccupied,
  mirror,
  moveDest,
  other,
} from "./board.ts";

/**
 * All legal single-die moves for `color` on `board`.
 *
 * Encodes the core movement rules:
 * - A checker on the bar must enter before anything else may move; entry
 *   with die d lands on point 25-d (inside the opponent's home board).
 * - A destination point is blocked if the opponent holds 2+ checkers
 *   there; a lone opposing blot may be hit.
 * - Bearing off requires every checker home (points 1..6). A die bears
 *   off exactly from its own point; a die larger than the highest
 *   occupied point bears off from that highest point only.
 */
export function legalSingleMoves(
  board: BoardState,
  color: Color,
  die: Die,
): Move[] {
  const own = board[color];
  const opp = board[other(color)];
  const moves: Move[] = [];

  const openForMe = (dest: number): boolean => opp[mirror(dest)] <= 1;

  if (own[BAR] > 0) {
    const dest = BAR - die;
    if (openForMe(dest)) {
      moves.push({ from: BAR, die });
    }
    return moves;
  }

  const canBearOff = allInHome(board, color);
  const highest = highestOccupied(board, color);

  for (let from = 24; from >= 1; from--) {
    if (own[from] === 0) continue;
    const dest = from - die;
    if (dest >= 1) {
      if (openForMe(dest)) moves.push({ from, die });
    } else if (canBearOff && (dest === 0 || from === highest)) {
      // dest === 0: exact bear-off. dest < 0: overshooting is only
      // allowed from the highest occupied point.
      moves.push({ from, die });
    }
  }

  return moves;
}

/** Orderings of the roll to try: both ways for mixed dice, ×4 for doubles. */
function diceSequences(dice: DicePair): Die[][] {
  const [a, b] = dice;
  if (a === b) return [[a, a, a, a]];
  return [
    [a, b],
    [b, a],
  ];
}

/**
 * Longest playable prefix of an ordered dice list (DFS). Skipping a die
 * to play a later one never helps: for mixed rolls the other ordering is
 * tried separately, and for doubles all dice are equal.
 */
function maxFromOrdered(
  board: BoardState,
  color: Color,
  remaining: Die[],
): number {
  if (remaining.length === 0) return 0;
  const [die, ...rest] = remaining;
  const candidates = legalSingleMoves(board, color, die);
  let best = 0;
  for (const move of candidates) {
    const played = 1 + maxFromOrdered(applyMove(board, color, move), color, rest);
    if (played > best) best = played;
    if (best === remaining.length) break; // can't do better
  }
  return best;
}

/** Max dice playable from a multiset of remaining dice (1-2 distinct values). */
function maxFromMultiset(
  board: BoardState,
  color: Color,
  remaining: Die[],
): number {
  if (remaining.length === 0) return 0;
  const distinct = [...new Set(remaining)];
  if (distinct.length === 1) {
    return maxFromOrdered(board, color, remaining);
  }
  // Two distinct dice can only mean one of each left: try both orders.
  return Math.max(
    maxFromOrdered(board, color, remaining),
    maxFromOrdered(board, color, [...remaining].reverse()),
  );
}

export interface RollAnalysis {
  /** How many dice can be played at best (0 = dance, turn is forfeit). */
  maxPlayable: number;
  /**
   * Set when exactly one die of a mixed roll can be played: the rules
   * require the higher die if it has any legal move, else the lower.
   */
  forcedDie: Die | null;
}

export function analyzeRoll(
  board: BoardState,
  color: Color,
  dice: DicePair,
): RollAnalysis {
  let maxPlayable = 0;
  for (const seq of diceSequences(dice)) {
    const played = maxFromOrdered(board, color, seq);
    if (played > maxPlayable) maxPlayable = played;
    if (maxPlayable === seq.length) break;
  }

  let forcedDie: Die | null = null;
  const [a, b] = dice;
  if (a !== b && maxPlayable === 1) {
    const hi = (a > b ? a : b) as Die;
    const lo = (a > b ? b : a) as Die;
    forcedDie = legalSingleMoves(board, color, hi).length > 0 ? hi : lo;
  }

  return { maxPlayable, forcedDie };
}

/** Dice of the roll not yet consumed by the staged moves. */
export function remainingDice(dice: DicePair, staged: Move[]): Die[] {
  const pool: Die[] =
    dice[0] === dice[1] ? [dice[0], dice[0], dice[0], dice[0]] : [...dice];
  for (const move of staged) {
    const idx = pool.indexOf(move.die);
    if (idx === -1) {
      throw new Error(`Die ${move.die} is not available in this roll`);
    }
    pool.splice(idx, 1);
  }
  return pool;
}

/**
 * Moves that may legally be staged next, given moves already staged this
 * turn. Only moves that still lead to a maximal-length turn are offered,
 * so the UI can never stage itself into a dead end that strands a
 * playable die — and the forced-higher-die rule is respected when only
 * one die can be played.
 *
 * `board` is the board as it stood at the START of the turn.
 */
export function legalNextMoves(
  board: BoardState,
  color: Color,
  dice: DicePair,
  staged: Move[],
): Move[] {
  const { maxPlayable, forcedDie } = analyzeRoll(board, color, dice);
  if (staged.length >= maxPlayable) return [];

  const remaining = remainingDice(dice, staged);
  const current = applyMoves(board, color, staged);
  const result: Move[] = [];

  for (const die of new Set(remaining)) {
    if (forcedDie !== null && die !== forcedDie) continue;
    const rest = [...remaining];
    rest.splice(rest.indexOf(die), 1);
    for (const move of legalSingleMoves(current, color, die)) {
      const after = applyMove(current, color, move);
      const total = staged.length + 1 + maxFromMultiset(after, color, rest);
      if (total >= maxPlayable) result.push(move);
    }
  }

  return result;
}

/**
 * Authoritative whole-turn validation: applies `moves` in order, checking
 * every rule, and returns the resulting board. Throws a player-readable
 * message on any violation. An empty `moves` is only valid when the roll
 * is a dance (maxPlayable 0).
 */
export function validateTurn(
  board: BoardState,
  color: Color,
  dice: DicePair,
  moves: Move[],
): BoardState {
  const limit = dice[0] === dice[1] ? 4 : 2;
  if (moves.length > limit) {
    throw new Error("Too many moves for this roll");
  }
  remainingDice(dice, moves); // throws if the moves overdraw the dice

  let current = board;
  for (const move of moves) {
    const legal = legalSingleMoves(current, color, move.die).some(
      (m) => m.from === move.from,
    );
    if (!legal) {
      throw new Error(describeIllegalMove(current, color, move));
    }
    current = applyMove(current, color, move);
  }

  const { maxPlayable, forcedDie } = analyzeRoll(board, color, dice);
  if (moves.length < maxPlayable) {
    throw new Error(
      maxPlayable === limit
        ? "You must play both dice"
        : `You must play ${maxPlayable} move${maxPlayable === 1 ? "" : "s"}`,
    );
  }
  if (forcedDie !== null && moves.length === 1 && moves[0].die !== forcedDie) {
    throw new Error(`You must play the ${forcedDie}`);
  }

  return current;
}

function describeIllegalMove(
  board: BoardState,
  color: Color,
  move: Move,
): string {
  const own = board[color];
  if (own[BAR] > 0 && move.from !== BAR) {
    return "You must enter from the bar first";
  }
  if (move.from !== BAR && (move.from < 1 || move.from > 24)) {
    return "Invalid point";
  }
  if (own[move.from] === 0) {
    return "No checker to move on that point";
  }
  const dest = moveDest(move);
  if (dest === 0 && !allInHome(board, color)) {
    return "You cannot bear off until all your checkers are home";
  }
  if (dest >= 1 && board[other(color)][mirror(dest)] >= 2) {
    return "That point is blocked";
  }
  return "That move is not allowed";
}
