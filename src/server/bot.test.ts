import { describe, expect, it } from "vitest";
import { BAR, OFF } from "../shared/types.ts";
import type { DicePair } from "../shared/types.ts";
import { applyMoves, startBoard } from "../shared/engine/board.ts";
import { enumerateTurns, validateTurn } from "../shared/engine/moves.ts";
import { pos } from "../shared/engine/testkit.ts";
import { pickTurn } from "./bot.ts";

describe("enumerateTurns", () => {
  it("returns only maximal, legal turns from the start position", () => {
    const board = startBoard();
    const dice: DicePair = [3, 1];
    const turns = enumerateTurns(board, "white", dice);

    expect(turns.length).toBeGreaterThan(1);
    for (const turn of turns) {
      expect(turn).toHaveLength(2);
      // Every enumerated turn must survive authoritative validation.
      expect(() => validateTurn(board, "white", dice, turn)).not.toThrow();
    }

    // The famous 3-1 opener (8/5, 6/5 making the 5 point) must be in there.
    const makesFivePoint = turns.some(
      (t) => applyMoves(board, "white", t).white[5] === 2,
    );
    expect(makesFivePoint).toBe(true);
  });

  it("expands doubles to four moves", () => {
    const board = startBoard();
    const turns = enumerateTurns(board, "white", [2, 2]);
    expect(turns.length).toBeGreaterThan(0);
    for (const turn of turns) expect(turn).toHaveLength(4);
  });

  it("dedupes transpositions that reach the same position", () => {
    // 24/23 and 13/11 in either order is one distinct play.
    const board = pos({ 24: 1, 13: 1, 6: 13 }, { 6: 15 });
    const turns = enumerateTurns(board, "white", [1, 2]);
    const positions = new Set(
      turns.map((t) => applyMoves(board, "white", t).white.join(",")),
    );
    expect(turns.length).toBe(positions.size);
  });

  it("returns a single empty turn on a dance", () => {
    // White has a checker on the bar; black owns every entry point.
    const board = pos(
      { [BAR]: 1, 6: 14 },
      { 1: 2, 2: 2, 3: 2, 4: 2, 5: 2, 6: 2, 13: 3 },
    );
    expect(enumerateTurns(board, "white", [3, 5])).toEqual([[]]);
  });

  it("respects the forced-higher-die rule", () => {
    // Only one die is playable; enumerated turns must all use the forced one.
    const board = pos({ 13: 2, 6: 13 }, { 8: 2, 11: 2, 6: 11 });
    const dice: DicePair = [2, 5];
    const turns = enumerateTurns(board, "white", dice);
    for (const turn of turns) {
      expect(() => validateTurn(board, "white", dice, turn)).not.toThrow();
    }
  });
});

describe("pickTurn", () => {
  it("always returns a legal, maximal turn", () => {
    const board = startBoard();
    for (const dice of [
      [3, 1],
      [6, 5],
      [4, 4],
      [2, 1],
      [6, 1],
    ] as DicePair[]) {
      const moves = pickTurn(board, "white", dice);
      expect(() => validateTurn(board, "white", dice, moves)).not.toThrow();
    }
  });

  it("takes an available hit", () => {
    // Black has a lone blot on white's 5 point; white can hit from 6 with a 1.
    const board = pos({ 6: 2, 13: 5, 8: 3, 24: 5 }, { 20: 1, 6: 8, 13: 6 });
    const moves = pickTurn(board, "white", [1, 3]);
    const after = applyMoves(board, "white", moves);
    expect(after.black[BAR]).toBe(1);
  });

  it("prefers making a point over leaving two blots", () => {
    // 3-1 from the start position: the 5 point is the known best play.
    const board = startBoard();
    const moves = pickTurn(board, "white", [3, 1]);
    const after = applyMoves(board, "white", moves);
    expect(after.white[5]).toBe(2);
  });

  it("bears off when racing", () => {
    const board = pos({ 6: 2, 5: 2, 4: 2, 3: 2, 2: 2, 1: 5 }, { 1: 15 });
    const moves = pickTurn(board, "white", [6, 5]);
    const after = applyMoves(board, "white", moves);
    expect(after.white[OFF]).toBe(2);
  });

  it("enters from the bar rather than stalling", () => {
    const board = pos({ [BAR]: 1, 13: 5, 8: 3, 6: 6 }, { 6: 10, 13: 5 });
    const moves = pickTurn(board, "white", [4, 2]);
    expect(moves.length).toBeGreaterThan(0);
    expect(moves[0].from).toBe(BAR);
    const after = applyMoves(board, "white", moves);
    expect(after.white[BAR]).toBe(0);
  });

  it("never stalls: returns something playable for every roll", () => {
    const board = startBoard();
    for (let a = 1; a <= 6; a++) {
      for (let b = 1; b <= 6; b++) {
        const dice = [a, b] as DicePair;
        const moves = pickTurn(board, "white", dice);
        expect(moves.length).toBeGreaterThan(0);
        expect(() => validateTurn(board, "white", dice, moves)).not.toThrow();
      }
    }
  });

  it("is deterministic for a given position", () => {
    const board = startBoard();
    const a = pickTurn(board, "white", [6, 5]);
    const b = pickTurn(board, "white", [6, 5]);
    expect(a).toEqual(b);
  });
});
