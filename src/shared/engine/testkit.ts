import { OFF } from "../types.ts";
import type { BoardState } from "../types.ts";
import { assertValidBoard } from "./board.ts";

/**
 * Test-only sparse position builder. Keys are point numbers in the
 * owner's own numbering (0=OFF, 25=BAR); any checkers not placed are
 * auto-filled as borne off so each side always sums to 15.
 */
export function side(spec: Record<number, number>): number[] {
  const arr = new Array<number>(26).fill(0);
  let placed = 0;
  for (const [point, count] of Object.entries(spec)) {
    arr[Number(point)] = count;
    placed += count;
  }
  arr[OFF] += 15 - placed;
  return arr;
}

export function pos(
  white: Record<number, number>,
  black: Record<number, number>,
): BoardState {
  const board = { white: side(white), black: side(black) };
  assertValidBoard(board);
  return board;
}
