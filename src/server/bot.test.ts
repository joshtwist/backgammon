import { describe, expect, it } from "vitest";
import { BAR, OFF } from "../shared/types.ts";
import type { DicePair } from "../shared/types.ts";
import { applyMoves, startBoard } from "../shared/engine/board.ts";
import { enumerateTurns, validateTurn } from "../shared/engine/moves.ts";
import { pos } from "../shared/engine/testkit.ts";
import { pickTurn } from "./bot.ts";

/**
 * Difficulty slips are decided by `random() < slipChance`, so a random()
 * pinned at 1 never slips and one pinned at 0 always slips (and then
 * picks the first candidate). Tactical assertions use `noSlip` so they
 * test the heuristic itself rather than the dice of the slip roll.
 */
const noSlip = () => 1;
const alwaysSlip = () => 0;

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
    const moves = pickTurn(board, "white", [1, 3], { random: noSlip });
    const after = applyMoves(board, "white", moves);
    expect(after.black[BAR]).toBe(1);
  });

  it("prefers making a point over leaving two blots", () => {
    // 3-1 from the start position: the 5 point is the known best play.
    const board = startBoard();
    const moves = pickTurn(board, "white", [3, 1], { random: noSlip });
    const after = applyMoves(board, "white", moves);
    expect(after.white[5]).toBe(2);
  });

  it("bears off when racing", () => {
    const board = pos({ 6: 2, 5: 2, 4: 2, 3: 2, 2: 2, 1: 5 }, { 1: 15 });
    const moves = pickTurn(board, "white", [6, 5], { random: noSlip });
    const after = applyMoves(board, "white", moves);
    expect(after.white[OFF]).toBe(2);
  });

  it("enters from the bar rather than stalling", () => {
    const board = pos({ [BAR]: 1, 13: 5, 8: 3, 6: 6 }, { 6: 10, 13: 5 });
    const moves = pickTurn(board, "white", [4, 2], { random: noSlip });
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

  it("is deterministic for a given position and difficulty", () => {
    const board = startBoard();
    // Hard never slips, so it needs no pinned RNG to repeat itself.
    expect(pickTurn(board, "white", [6, 5], { difficulty: "hard" })).toEqual(
      pickTurn(board, "white", [6, 5], { difficulty: "hard" }),
    );
    expect(pickTurn(board, "white", [6, 5], { random: noSlip })).toEqual(
      pickTurn(board, "white", [6, 5], { random: noSlip }),
    );
  });
});

describe("difficulty", () => {
  it("easy slips to a different (still legal) turn", () => {
    const board = startBoard();
    const dice: DicePair = [3, 1];

    const best = pickTurn(board, "white", dice, { random: noSlip });
    const slipped = pickTurn(board, "white", dice, {
      difficulty: "easy",
      random: alwaysSlip,
    });

    expect(slipped).not.toEqual(best);
    // A slip is a worse choice, never an illegal one.
    expect(() => validateTurn(board, "white", dice, slipped)).not.toThrow();
  });

  it("easy still plays best when it doesn't slip", () => {
    const board = startBoard();
    const dice: DicePair = [3, 1];
    expect(
      pickTurn(board, "white", dice, { difficulty: "easy", random: noSlip }),
    ).toEqual(pickTurn(board, "white", dice, { random: noSlip }));
  });

  it("hard never slips, whatever the RNG says", () => {
    const board = startBoard();
    const dice: DicePair = [3, 1];
    expect(
      pickTurn(board, "white", dice, {
        difficulty: "hard",
        random: alwaysSlip,
      }),
    ).toEqual(
      pickTurn(board, "white", dice, { difficulty: "hard", random: noSlip }),
    );
  });

  it("easy slips far more often than medium over many turns", () => {
    // Drive the real slip logic with a deterministic pseudo-random stream
    // so the rates are checkable without flakiness.
    let seed = 1;
    const rng = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const board = startBoard();
    const dice: DicePair = [3, 1];
    const best = pickTurn(board, "white", dice, { random: noSlip });

    const rate = (difficulty: "easy" | "medium") => {
      let off = 0;
      for (let i = 0; i < 400; i++) {
        const t = pickTurn(board, "white", dice, { difficulty, random: rng });
        if (JSON.stringify(t) !== JSON.stringify(best)) off++;
      }
      return off / 400;
    };

    const easyRate = rate("easy");
    const mediumRate = rate("medium");
    expect(easyRate).toBeGreaterThan(mediumRate);
    expect(easyRate).toBeGreaterThan(0.2);
    expect(mediumRate).toBeLessThan(0.3);
  });

  it("every difficulty plays legally across the whole roll matrix", () => {
    const board = startBoard();
    for (const difficulty of ["easy", "medium", "hard"] as const) {
      for (let a = 1; a <= 6; a++) {
        for (let b = 1; b <= 6; b++) {
          const dice = [a, b] as DicePair;
          const moves = pickTurn(board, "white", dice, { difficulty });
          expect(() =>
            validateTurn(board, "white", dice, moves),
          ).not.toThrow();
        }
      }
    }
  });

  it("hard's lookahead actually changes decisions vs one-ply", () => {
    // Proof the second ply does work: across the roll matrix from the
    // start position, hard must disagree with the one-ply pick at least
    // once. (If it never disagreed, the lookahead would be dead code.)
    const board = startBoard();
    let disagreements = 0;
    for (let a = 1; a <= 6; a++) {
      for (let b = a; b <= 6; b++) {
        const dice = [a, b] as DicePair;
        const onePly = pickTurn(board, "white", dice, { random: noSlip });
        const twoPly = pickTurn(board, "white", dice, { difficulty: "hard" });
        expect(() => validateTurn(board, "white", dice, twoPly)).not.toThrow();
        if (JSON.stringify(onePly) !== JSON.stringify(twoPly)) disagreements++;
      }
    }
    expect(disagreements).toBeGreaterThan(0);
  });

  it("hard stays fast enough for a live turn", () => {
    const board = startBoard();
    const started = Date.now();
    // Doubles produce the longest candidate lists — the worst case.
    pickTurn(board, "white", [6, 6], { difficulty: "hard" });
    pickTurn(board, "white", [3, 3], { difficulty: "hard" });
    pickTurn(board, "white", [1, 1], { difficulty: "hard" });
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

describe("hit appetite", () => {
  it("declines a worthless hit that would break a made point", () => {
    // Black's blot sits on white's 2 point, so hitting it costs black a
    // mere 2 pips — but 6/2* breaks white's made 6 point and leaves two
    // blots. Sound play declines. (The old flat per-hit bonus took it.)
    const board = pos(
      { 6: 2, 8: 3, 13: 5, 24: 2, 5: 3 },
      { 23: 1, 6: 5, 8: 3, 13: 6 },
    );
    const dice: DicePair = [4, 1];
    const moves = pickTurn(board, "white", dice, { random: noSlip });
    const after = applyMoves(board, "white", moves);

    expect(() => validateTurn(board, "white", dice, moves)).not.toThrow();
    expect(after.black[BAR]).toBe(0); // didn't take the junk hit
    expect(after.white[6]).toBe(2); // kept the point
  });

  it("still takes a hit that actually costs the opponent ground", () => {
    // The mirror case: black's blot is nearly home (its 5 point = white's
    // 20), so hitting it with 24/20* sets black back a full 20 pips. That
    // hit is worth taking, and the retune must not have killed it.
    const board = pos(
      { 24: 2, 13: 5, 8: 3, 6: 5 },
      { 5: 1, 6: 5, 8: 3, 13: 6 },
    );
    const dice: DicePair = [4, 3];
    const moves = pickTurn(board, "white", dice, { random: noSlip });
    const after = applyMoves(board, "white", moves);
    expect(after.black[BAR]).toBe(1);
  });
});
