import { BAR, OFF } from "../types.ts";
import type { BoardState, Color, Move } from "../types.ts";

export function other(color: Color): Color {
  return color === "white" ? "black" : "white";
}

/** My point p seen in the opponent's numbering (valid for p in 1..24). */
export function mirror(p: number): number {
  return 25 - p;
}

function emptySide(): number[] {
  return new Array<number>(26).fill(0);
}

function startSide(): number[] {
  const side = emptySide();
  side[24] = 2;
  side[13] = 5;
  side[8] = 3;
  side[6] = 5;
  return side;
}

/** Standard starting position (pip count 167 for both). */
export function startBoard(): BoardState {
  return { white: startSide(), black: startSide() };
}

export function cloneBoard(board: BoardState): BoardState {
  return { white: [...board.white], black: [...board.black] };
}

/** Destination point for a move; 0 (=OFF) means borne off. */
export function moveDest(move: Move): number {
  return Math.max(move.from - move.die, OFF);
}

/** True when every checker is on points 1..6 or already borne off. */
export function allInHome(board: BoardState, color: Color): boolean {
  const own = board[color];
  if (own[BAR] > 0) return false;
  for (let p = 7; p <= 24; p++) {
    if (own[p] > 0) return false;
  }
  return true;
}

/** Highest own-numbering point (1..24) with a checker on it; 0 if none. */
export function highestOccupied(board: BoardState, color: Color): number {
  const own = board[color];
  for (let p = 24; p >= 1; p--) {
    if (own[p] > 0) return p;
  }
  return 0;
}

/** Total pips left: sum of point-distance for every checker (bar = 25). */
export function pipCount(board: BoardState, color: Color): number {
  const own = board[color];
  let pips = own[BAR] * 25;
  for (let p = 1; p <= 24; p++) {
    pips += own[p] * p;
  }
  return pips;
}

/**
 * Apply one move for `color`, returning a new board. Assumes the move is
 * legal (callers validate via legalSingleMoves); still guards the basics
 * so a bug can't silently corrupt the board.
 */
export function applyMove(
  board: BoardState,
  color: Color,
  move: Move,
): BoardState {
  const next = cloneBoard(board);
  const own = next[color];
  const opp = next[other(color)];

  if (own[move.from] <= 0) {
    throw new Error("No checker to move on that point");
  }

  own[move.from]--;
  const dest = moveDest(move);
  own[dest]++;

  // Hit: landing on a point where the opponent has a lone blot sends
  // that checker to the opponent's bar. (dest 0 = bearing off, no hit.)
  if (dest >= 1 && dest <= 24 && opp[mirror(dest)] === 1) {
    opp[mirror(dest)] = 0;
    opp[BAR]++;
  }

  return next;
}

export function applyMoves(
  board: BoardState,
  color: Color,
  moves: Move[],
): BoardState {
  let current = board;
  for (const move of moves) {
    current = applyMove(current, color, move);
  }
  return current;
}

/**
 * Sanity check used by tests and the test-only _test_set_position hook:
 * both sides sum to 15, counts are non-negative integers, and no point
 * is occupied by both colors.
 */
export function assertValidBoard(board: BoardState): void {
  for (const color of ["white", "black"] as const) {
    const side = board[color];
    if (side.length !== 26) {
      throw new Error(`${color} side must have 26 slots`);
    }
    let sum = 0;
    for (const count of side) {
      if (!Number.isInteger(count) || count < 0) {
        throw new Error(`${color} side has an invalid count`);
      }
      sum += count;
    }
    if (sum !== 15) {
      throw new Error(`${color} must have exactly 15 checkers, found ${sum}`);
    }
  }
  for (let p = 1; p <= 24; p++) {
    if (board.white[p] > 0 && board.black[mirror(p)] > 0) {
      throw new Error(`Point ${p} is occupied by both colors`);
    }
  }
}
