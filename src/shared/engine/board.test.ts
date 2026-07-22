import { describe, expect, it } from "vitest";
import { BAR, OFF } from "../types.ts";
import {
  applyMove,
  assertValidBoard,
  pipCount,
  startBoard,
} from "./board.ts";
import { pos } from "./testkit.ts";

describe("startBoard", () => {
  it("is a valid position with pip count 167 for both colors", () => {
    const board = startBoard();
    expect(() => assertValidBoard(board)).not.toThrow();
    expect(pipCount(board, "white")).toBe(167);
    expect(pipCount(board, "black")).toBe(167);
  });
});

describe("applyMove", () => {
  it("moves a checker without touching the opponent", () => {
    const board = startBoard();
    const next = applyMove(board, "white", { from: 13, die: 5 });
    expect(next.white[13]).toBe(4);
    expect(next.white[8]).toBe(4);
    expect(next.black).toEqual(board.black);
    // Original board is untouched (pure function)
    expect(board.white[13]).toBe(5);
  });

  it("hits a white-perspective blot: black checker goes to the bar", () => {
    // Black blot on black's 17 = white's 8.
    const board = pos({ 13: 5, 6: 10 }, { 17: 1, 6: 10, 13: 4 });
    const next = applyMove(board, "white", { from: 13, die: 5 });
    expect(next.white[8]).toBe(1);
    expect(next.black[17]).toBe(0);
    expect(next.black[BAR]).toBe(1);
  });

  it("hits a black-perspective blot: white checker goes to the bar", () => {
    // White blot on white's 21 = black's 4.
    const board = pos({ 21: 1, 6: 14 }, { 6: 10, 13: 5 });
    const next = applyMove(board, "black", { from: 6, die: 2 });
    expect(next.black[4]).toBe(1);
    expect(next.white[21]).toBe(0);
    expect(next.white[BAR]).toBe(1);
  });

  it("bearing off increments OFF and never hits", () => {
    const board = pos({ 4: 2, 3: 13 }, { 6: 15 });
    const next = applyMove(board, "white", { from: 4, die: 4 });
    expect(next.white[OFF]).toBe(1);
    expect(next.white[4]).toBe(1);
    expect(next.black[BAR]).toBe(0);
  });
});
