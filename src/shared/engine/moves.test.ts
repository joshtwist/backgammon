import { describe, expect, it } from "vitest";
import { BAR } from "../types.ts";
import type { DicePair, Move } from "../types.ts";
import { startBoard } from "./board.ts";
import {
  analyzeRoll,
  legalNextMoves,
  legalSingleMoves,
  validateTurn,
} from "./moves.ts";
import { pos } from "./testkit.ts";

const has = (moves: Move[], from: number, die: number) =>
  moves.some((m) => m.from === from && m.die === die);

describe("legalSingleMoves — basics", () => {
  it("excludes destinations the opponent holds with 2+, includes blots", () => {
    // White 13→8 with a 5. Black's 17 is white's 8.
    const blocked = pos({ 13: 1, 6: 14 }, { 17: 2, 6: 10, 13: 3 });
    expect(has(legalSingleMoves(blocked, "white", 5), 13, 5)).toBe(false);

    const blot = pos({ 13: 1, 6: 14 }, { 17: 1, 6: 10, 13: 4 });
    expect(has(legalSingleMoves(blot, "white", 5), 13, 5)).toBe(true);
  });

  it("bar priority: only entry moves are offered while on the bar", () => {
    // Entry with a 3 lands on white's 22 (open here).
    const board = pos({ [BAR]: 1, 13: 2, 1: 12 }, { 6: 10, 13: 5 });
    const moves = legalSingleMoves(board, "white", 3);
    expect(moves).toEqual([{ from: BAR, die: 3 }]);
  });

  it("bar entry is blocked by 2+ opponent checkers on the entry point", () => {
    // White entry with a 3 lands on white's 22 = black's 3.
    const board = pos({ [BAR]: 1, 13: 2, 1: 12 }, { 3: 2, 6: 8, 13: 5 });
    expect(legalSingleMoves(board, "white", 3)).toEqual([]);
  });
});

describe("legalSingleMoves — bearing off", () => {
  it("exact die bears off even when higher points are occupied", () => {
    const board = pos({ 6: 2, 4: 3, 2: 5, 1: 5 }, { 6: 15 });
    expect(has(legalSingleMoves(board, "white", 4), 4, 4)).toBe(true);
    expect(has(legalSingleMoves(board, "white", 6), 6, 6)).toBe(true);
  });

  it("a die above the highest point bears off from the highest point only", () => {
    const board = pos({ 4: 2, 3: 3, 2: 5, 1: 5 }, { 6: 15 });
    expect(has(legalSingleMoves(board, "white", 6), 4, 6)).toBe(true);

    const withFive = pos({ 5: 1, 4: 2, 2: 6, 1: 6 }, { 6: 15 });
    const sixes = legalSingleMoves(withFive, "white", 6);
    expect(has(sixes, 5, 6)).toBe(true);
    expect(has(sixes, 4, 6)).toBe(false);
  });

  it("no bear-offs while a checker is outside home or on the bar", () => {
    const outside = pos({ 7: 1, 4: 2, 2: 6, 1: 6 }, { 6: 15 });
    for (const m of legalSingleMoves(outside, "white", 4)) {
      expect(m.from - m.die).toBeGreaterThan(0);
    }

    // After being hit mid-bear-off, only re-entry is offered.
    const onBar = pos({ [BAR]: 1, 4: 2, 2: 6, 1: 6 }, { 6: 15 });
    expect(legalSingleMoves(onBar, "white", 4)).toEqual([
      { from: BAR, die: 4 },
    ]);
  });

  it("hitting a blot inside my home keeps bear-offs available", () => {
    // Black blot on black's 22 = white's 3. White plays 5→3 (die 2), hits,
    // and can still bear off with the other die.
    const board = pos({ 5: 2, 6: 1, 2: 5, 1: 7 }, { 22: 1, 6: 8, 13: 6 });
    const afterHit = validateTurn(board, "white", [2, 6], [
      { from: 5, die: 2 },
      { from: 6, die: 6 },
    ]);
    expect(afterHit.black[BAR]).toBe(1);
    expect(afterHit.black[22]).toBe(0);
    expect(afterHit.white[0]).toBe(1); // the 6 bore off
    expect(afterHit.white[3]).toBe(1); // the hitter landed on the 3
  });
});

describe("analyzeRoll — forced play", () => {
  it("detects a dance: both entry points blocked", () => {
    const board = pos(
      { [BAR]: 1, 6: 5, 5: 5, 4: 4 },
      { 3: 2, 5: 2, 6: 6, 13: 5 },
    );
    // Entries: die 3 → white 22 (=black 3, blocked), die 5 → white 20 (=black 5, blocked)
    const analysis = analyzeRoll(board, "white", [3, 5]);
    expect(analysis.maxPlayable).toBe(0);
  });

  it("forces the LOWER die when the higher has no legal move", () => {
    // Two on the bar: die 3 enters (white 22 open), die 5 blocked (black 5).
    const board = pos(
      { [BAR]: 2, 6: 5, 5: 4, 4: 4 },
      { 5: 2, 6: 6, 13: 7 },
    );
    const analysis = analyzeRoll(board, "white", [3, 5]);
    expect(analysis.maxPlayable).toBe(1);
    expect(analysis.forcedDie).toBe(3);
  });

  it("forces the HIGHER die when either could be played but not both", () => {
    // Only white's back checker can move: 18 and 19 are open but 13 is
    // blocked, so whichever die is played first strands the other →
    // exactly one die can be played, and it must be the 6.
    const board = pos(
      { 24: 1, 3: 5, 2: 5, 1: 4 },
      { 12: 2, 5: 3, 4: 3, 3: 3, 2: 4 },
    );
    const analysis = analyzeRoll(board, "white", [6, 5]);
    expect(legalSingleMoves(board, "white", 6).length).toBeGreaterThan(0);
    expect(legalSingleMoves(board, "white", 5).length).toBeGreaterThan(0);
    expect(analysis.maxPlayable).toBe(1);
    expect(analysis.forcedDie).toBe(6);

    expect(() =>
      validateTurn(board, "white", [6, 5], [{ from: 24, die: 5 }]),
    ).toThrow(/must play the 6/);
    const after = validateTurn(board, "white", [6, 5], [{ from: 24, die: 6 }]);
    expect(after.white[18]).toBe(1);
  });

  it("finds the ordering where both dice play even if the other ordering plays none", () => {
    // 24/18 with the 6, then 18/13 with the 5 is the ONLY full play:
    // playing the 5 first is impossible (19 blocked, nothing else moves).
    const board = pos(
      { 24: 1, 1: 14 },
      { 6: 2, 5: 4, 4: 4, 3: 5 },
    );
    const analysis = analyzeRoll(board, "white", [6, 5]);
    expect(legalSingleMoves(board, "white", 5)).toEqual([]);
    expect(analysis.maxPlayable).toBe(2);

    expect(() =>
      validateTurn(board, "white", [6, 5], [{ from: 24, die: 6 }]),
    ).toThrow(/must play both dice/);
    const after = validateTurn(board, "white", [6, 5], [
      { from: 24, die: 6 },
      { from: 18, die: 5 },
    ]);
    expect(after.white[13]).toBe(1);
  });

  it("caps doubles at what is actually playable", () => {
    // 3-3: both back checkers can hop 24→21 once each (18 is blocked),
    // plus 5→2. No fourth 3 exists anywhere → exactly 3 playable.
    const board = pos(
      { 24: 2, 5: 1, 1: 12 },
      { 7: 2, 6: 4, 5: 4, 2: 5 },
    );
    const analysis = analyzeRoll(board, "white", [3, 3]);
    expect(analysis.maxPlayable).toBe(3);

    const full: Move[] = [
      { from: 24, die: 3 },
      { from: 24, die: 3 },
      { from: 5, die: 3 },
    ];
    expect(() =>
      validateTurn(board, "white", [3, 3], full.slice(0, 2)),
    ).toThrow(/must play 3 moves/);
    expect(() =>
      validateTurn(board, "white", [3, 3], [
        ...full,
        { from: 21, die: 3 },
      ]),
    ).toThrow(); // 4th move is onto the blocked 18
    expect(() => validateTurn(board, "white", [3, 3], full)).not.toThrow();
  });

  it("plays doubles from the bar: enter twice, then move twice", () => {
    const board = pos({ [BAR]: 2, 1: 13 }, { 6: 5, 5: 5, 3: 5 });
    const analysis = analyzeRoll(board, "white", [4, 4]);
    expect(analysis.maxPlayable).toBe(4);
    const after = validateTurn(board, "white", [4, 4], [
      { from: BAR, die: 4 },
      { from: BAR, die: 4 },
      { from: 21, die: 4 },
      { from: 21, die: 4 },
    ]);
    expect(after.white[17]).toBe(2);
  });

  it("enter-then-stuck: entry consumes the only playable die", () => {
    // Bar entry with the 6 (→19) is blocked; entry with the 2 (→23) is
    // open, but afterwards the 6 has nowhere to go (17 blocked).
    const board = pos(
      { [BAR]: 1, 1: 14 },
      { 6: 2, 8: 2, 5: 5, 4: 3, 3: 3 },
    );
    const analysis = analyzeRoll(board, "white", [6, 2]);
    expect(analysis.maxPlayable).toBe(1);
    expect(analysis.forcedDie).toBe(2);
  });
});

describe("legalNextMoves — staging support", () => {
  it("never offers a move that strands the other die", () => {
    // Dice 6-3. Playing 8/5 with the 3 leaves the 6 unplayable (18 is
    // blocked and 5-6 can't bear off) — so 8/5 must not be offered.
    const board = pos(
      { 24: 1, 8: 1, 1: 13 },
      { 7: 2, 6: 5, 5: 4, 3: 4 },
    );
    const dice: DicePair = [6, 3];
    expect(analyzeRoll(board, "white", dice).maxPlayable).toBe(2);

    const first = legalNextMoves(board, "white", dice, []);
    expect(has(first, 24, 3)).toBe(true);
    expect(has(first, 8, 6)).toBe(true);
    expect(has(first, 8, 3)).toBe(false); // the dead end

    // After staging 24/21 with the 3, only 6s remain: 21/15 or 8/2.
    const second = legalNextMoves(board, "white", dice, [{ from: 24, die: 3 }]);
    expect(second.every((m) => m.die === 6)).toBe(true);
    expect(has(second, 8, 6)).toBe(true);
    expect(has(second, 21, 6)).toBe(true);
  });

  it("offers nothing once the staged turn is maximal", () => {
    const board = startBoard();
    const dice: DicePair = [3, 1];
    const staged: Move[] = [
      { from: 8, die: 3 },
      { from: 6, die: 1 },
    ];
    expect(legalNextMoves(board, "white", dice, staged)).toEqual([]);
  });

  it("respects the forced higher die", () => {
    const board = pos(
      { 24: 1, 3: 5, 2: 5, 1: 4 },
      { 12: 2, 5: 3, 4: 3, 3: 3, 2: 4 },
    );
    const moves = legalNextMoves(board, "white", [6, 5], []);
    expect(moves.every((m) => m.die === 6)).toBe(true);
    expect(moves.length).toBeGreaterThan(0);
  });
});

describe("validateTurn — rejection matrix", () => {
  const board = startBoard();
  const dice: DicePair = [3, 1];

  it("rejects a die that is not part of the roll", () => {
    expect(() =>
      validateTurn(board, "white", dice, [{ from: 24, die: 5 }]),
    ).toThrow(/not available/);
  });

  it("rejects using the same die twice on a mixed roll", () => {
    expect(() =>
      validateTurn(board, "white", dice, [
        { from: 24, die: 3 },
        { from: 13, die: 3 },
      ]),
    ).toThrow(/not available/);
  });

  it("rejects moving from an empty point", () => {
    expect(() =>
      validateTurn(board, "white", dice, [
        { from: 2, die: 3 },
        { from: 6, die: 1 },
      ]),
    ).toThrow(/No checker/);
  });

  it("rejects board moves while a checker waits on the bar", () => {
    const barBoard = pos({ [BAR]: 1, 13: 2, 1: 12 }, { 6: 10, 13: 5 });
    expect(() =>
      validateTurn(barBoard, "white", [3, 1], [
        { from: 13, die: 3 },
        { from: BAR, die: 1 },
      ]),
    ).toThrow(/enter from the bar/);
  });

  it("rejects more moves than the roll allows", () => {
    expect(() =>
      validateTurn(board, "white", [3, 3], [
        { from: 13, die: 3 },
        { from: 13, die: 3 },
        { from: 13, die: 3 },
        { from: 13, die: 3 },
        { from: 13, die: 3 },
      ]),
    ).toThrow(/Too many moves/);
  });

  it("rejects an empty turn when moves exist", () => {
    expect(() => validateTurn(board, "white", dice, [])).toThrow(
      /must play both dice/,
    );
  });

  it("accepts the classic 3-1 making the 5-point", () => {
    const after = validateTurn(board, "white", dice, [
      { from: 8, die: 3 },
      { from: 6, die: 1 },
    ]);
    expect(after.white[5]).toBe(2);
    expect(after.white[8]).toBe(2);
    expect(after.white[6]).toBe(4);
  });
});
