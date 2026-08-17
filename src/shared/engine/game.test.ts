import { describe, expect, it } from "vitest";
import { BAR } from "../types.ts";
import type { DicePair } from "../types.ts";
import {
  addPlayer,
  buildSeed,
  confirmTurn,
  createGame,
  createRematch,
  passNoMoves,
  rollDice,
  rollOpeningDie,
  seedGame,
  startGame,
  winKindOf,
} from "./game.ts";
import type { GameState } from "./game.ts";
import { enumerateTurns } from "./moves.ts";
import { pos } from "./testkit.ts";

function lobbyWithTwo(): GameState {
  let state = createGame("test01");
  state = addPlayer(state, "p-white", "Josh", "rocket");
  state = addPlayer(state, "p-black", "Anna", "cat");
  return state;
}

function playing(
  overrides: Partial<GameState> = {},
): GameState {
  let state = startGame(lobbyWithTwo(), "p-white");
  state = rollOpeningDie(state, "p-white", 5);
  state = rollOpeningDie(state, "p-black", 2);
  return { ...state, ...overrides };
}

describe("lobby", () => {
  it("assigns white to the creator and black to the second player", () => {
    const state = lobbyWithTwo();
    expect(state.creatorId).toBe("p-white");
    expect(state.players[0].color).toBe("white");
    expect(state.players[1].color).toBe("black");
  });

  it("rejects a third player, duplicate icons, and blank names", () => {
    const state = lobbyWithTwo();
    expect(() => addPlayer(state, "p3", "Max", "dog")).toThrow(/full/);

    let one = createGame("x");
    one = addPlayer(one, "p1", "Josh", "rocket");
    expect(() => addPlayer(one, "p2", "Anna", "rocket")).toThrow(/taken/);
    expect(() => addPlayer(one, "p2", "   ", "cat")).toThrow(/name/);
  });

  it("only the creator can start, and only with exactly 2 players", () => {
    let one = createGame("x");
    one = addPlayer(one, "p1", "Josh", "rocket");
    expect(() => startGame(one, "p1")).toThrow(/exactly 2/);

    const two = lobbyWithTwo();
    expect(() => startGame(two, "p-black")).toThrow(/creator/);
    expect(startGame(two, "p-white").phase).toBe("opening");
  });
});

describe("opening roll", () => {
  it("ties re-arm both dice and are recorded", () => {
    let state = startGame(lobbyWithTwo(), "p-white");
    state = rollOpeningDie(state, "p-white", 3);
    expect(() => rollOpeningDie(state, "p-white", 4)).toThrow(/already rolled/);
    state = rollOpeningDie(state, "p-black", 3);

    expect(state.phase).toBe("opening");
    expect(state.opening?.rolls).toEqual({ white: null, black: null });
    expect(state.opening?.lastTie).toBe(3);
    expect(state.opening?.tieCount).toBe(1);
  });

  it("the higher roller moves first and plays both dice", () => {
    let state = startGame(lobbyWithTwo(), "p-white");
    state = rollOpeningDie(state, "p-black", 2);
    state = rollOpeningDie(state, "p-white", 5);

    expect(state.phase).toBe("playing");
    expect(state.opening).toBeNull();
    expect(state.turnNumber).toBe(1);
    expect(state.turn?.color).toBe("white");
    expect(state.turn?.phase).toBe("move");
    expect(state.turn?.dice).toEqual([5, 2]);
    expect(state.turn?.maxPlayable).toBe(2);
  });

  it("rejects rolls from non-players", () => {
    const state = startGame(lobbyWithTwo(), "p-white");
    expect(() => rollOpeningDie(state, "stranger", 4)).toThrow(/not a player/);
  });
});

describe("turns", () => {
  it("plays a full turn and hands over to the opponent", () => {
    let state = playing();
    // White won the opening 5-2: play 13/8, 13/11 (24/19 would be blocked
    // by black's start-position 6-point).
    state = confirmTurn(state, "p-white", [
      { from: 13, die: 5 },
      { from: 13, die: 2 },
    ]);

    expect(state.turn?.color).toBe("black");
    expect(state.turn?.phase).toBe("roll");
    expect(state.turn?.dice).toBeNull();
    expect(state.lastTurn?.color).toBe("white");
    expect(state.lastTurn?.moves).toHaveLength(2);

    state = rollDice(state, "p-black", [6, 6]);
    expect(state.turn?.phase).toBe("move");
    expect(state.turnNumber).toBe(2);
  });

  it("rejects out-of-turn and out-of-phase actions", () => {
    const state = playing();
    expect(() => rollDice(state, "p-white", [1, 2])).toThrow(/already rolled/);
    expect(() => rollDice(state, "p-black", [1, 2])).toThrow(/not your turn/);
    expect(() =>
      confirmTurn(state, "p-black", [{ from: 24, die: 5 }]),
    ).toThrow(/not your turn/);
  });

  it("a roll with no legal moves parks in no_moves and passes on", () => {
    // White is danced out: one on the bar, entries 22 and 20 blocked.
    const board = pos(
      { [BAR]: 1, 6: 5, 5: 5, 4: 4 },
      { 3: 2, 5: 2, 6: 6, 13: 5 },
    );
    let state = playing({
      board,
      turn: { color: "white", phase: "roll", dice: null, maxPlayable: 0, forcedDie: null },
    });

    state = rollDice(state, "p-white", [3, 5]);
    expect(state.turn?.phase).toBe("no_moves");
    expect(() =>
      confirmTurn(state, "p-white", []),
    ).toThrow(/Roll the dice first/);

    state = passNoMoves(state);
    expect(state.turn?.color).toBe("black");
    expect(state.turn?.phase).toBe("roll");
    expect(state.lastTurn).toMatchObject({ color: "white", moves: [] });
  });
});

describe("winning", () => {
  it("classifies single, gammon and both backgammon variants", () => {
    // Single: loser has borne off at least one.
    expect(
      winKindOf(pos({}, { 0: 1, 6: 14 }), "white"),
    ).toBe("single");
    // Gammon: loser has borne off none, none in winner's home or bar.
    expect(winKindOf(pos({}, { 6: 15 }), "white")).toBe("gammon");
    // Backgammon via bar…
    expect(
      winKindOf(pos({}, { [BAR]: 1, 6: 14 }), "white"),
    ).toBe("backgammon");
    // …and via a checker inside the winner's home board (black's 20 = white's 5).
    expect(
      winKindOf(pos({}, { 20: 1, 6: 14 }), "white"),
    ).toBe("backgammon");
  });

  it("bearing off the 15th checker completes the game and scores the series", () => {
    // White: one checker left on the ace point; black hasn't borne off
    // and has a checker in white's home → backgammon, 3 points.
    const board = pos({ 1: 1 }, { 20: 1, 6: 14 });
    let state = playing({ board });
    state = {
      ...state,
      turn: { color: "white", phase: "roll", dice: null, maxPlayable: 0, forcedDie: null },
    };
    state = rollDice(state, "p-white", [1, 4]);
    expect(state.turn?.maxPlayable).toBe(1);
    state = confirmTurn(state, "p-white", [{ from: 1, die: 4 }]);

    expect(state.phase).toBe("complete");
    expect(state.winner).toMatchObject({
      playerId: "p-white",
      color: "white",
      kind: "backgammon",
      points: 3,
    });
    expect(state.series).toEqual({ white: 3, black: 0, gamesPlayed: 1 });
    expect(state.turn).toBeNull();
  });
});

describe("rematch & series seeding", () => {
  function completedGame(): GameState {
    const board = pos({ 1: 1 }, { 0: 2, 6: 13 });
    let state = playing({ board });
    state = {
      ...state,
      turn: { color: "white", phase: "roll", dice: null, maxPlayable: 0, forcedDie: null },
      series: { white: 2, black: 3, gamesPlayed: 3 },
    };
    state = rollDice(state, "p-white", [1, 4]);
    return confirmTurn(state, "p-white", [{ from: 1, die: 4 }]);
  }

  it("createRematch records the pointer exactly once", () => {
    let state = completedGame();
    expect(state.series).toEqual({ white: 3, black: 3, gamesPlayed: 4 });

    state = createRematch(state, "p-black", "newid1");
    expect(state.rematch).toEqual({
      gameId: "newid1",
      creatorId: "p-black",
      creatorName: "Anna",
    });
    expect(() => createRematch(state, "p-white", "newid2")).toThrow(/already/);
  });

  it("seed round-trip: colors and scores survive into the next game", () => {
    const finished = completedGame();
    const seed = buildSeed(finished);
    expect(seed.gamesPlayed).toBe(4);
    expect(seed.entries).toContainEqual({
      name: "Josh",
      icon: "rocket",
      color: "white",
      score: 3,
    });

    let next = seedGame("nextid", seed);
    expect(next.series).toEqual({ white: 3, black: 3, gamesPlayed: 4 });

    // Anna joins first this time — she keeps black and her score.
    next = addPlayer(next, "new-anna", "Anna", "cat");
    expect(next.players[0].color).toBe("black");

    next = addPlayer(next, "new-josh", "Josh", "rocket");
    expect(next.players[1].color).toBe("white");
    expect(next.series).toEqual({ white: 3, black: 3, gamesPlayed: 4 });
  });

  it("a different identity taking a seeded seat zeroes that seat's score", () => {
    const seed = buildSeed(completedGame());
    let next = seedGame("nextid", seed);
    next = addPlayer(next, "new-anna", "Anna", "cat"); // black, score kept
    next = addPlayer(next, "someone-new", "Max", "dog"); // takes white
    expect(next.series.white).toBe(0);
    expect(next.series.black).toBe(3);
  });
});

describe("dice tally", () => {
  it("counts every die rolled, per side, and flags doubles", () => {
    let s = createGame("g");
    s = addPlayer(s, "a", "Josh", "rocket");
    s = addPlayer(s, "b", "Anna", "cat");
    s = startGame(s, "a");

    // Opening: white 6, black 2 -> white opens and plays [6,2].
    s = rollOpeningDie(s, "a", 6);
    s = rollOpeningDie(s, "b", 2);

    // Each opening die is credited to whoever rolled it, and doesn't
    // count as a two-dice "roll". White then PLAYS both opening dice, but
    // they aren't re-tallied — only one of them was white's own throw.
    expect(s.diceStats.white.faces[6]).toBe(1);
    expect(s.diceStats.black.faces[2]).toBe(1);
    expect(s.diceStats.white.faces[2]).toBe(0);
    expect(s.diceStats.white.rolls).toBe(0);

    const whiteBefore = s.diceStats.white.faces[6];
    // Play out white's opening turn so the roll passes to black.
    s = confirmTurn(s, "a", enumerateTurns(s.board, "white", [6, 2])[0]);

    // Black rolls doubles.
    s = rollDice(s, "b", [4, 4]);
    expect(s.diceStats.black.faces[4]).toBe(2);
    expect(s.diceStats.black.rolls).toBe(1);
    expect(s.diceStats.black.doubles).toBe(1);
    // White's tally untouched by black's roll.
    expect(s.diceStats.white.faces[6]).toBe(whiteBefore);
  });

  it("carries the tally across a rematch via the seed", () => {
    let s = createGame("g");
    s = addPlayer(s, "a", "Josh", "rocket");
    s = addPlayer(s, "b", "Anna", "cat");
    s = startGame(s, "a");
    s = rollOpeningDie(s, "a", 5);
    s = rollOpeningDie(s, "b", 3);

    const seed = buildSeed(s);
    expect(seed.diceStats?.white.faces[5]).toBe(1);

    const next = seedGame("g2", seed);
    expect(next.diceStats.white.faces[5]).toBe(1);
    expect(next.diceStats.black.faces[3]).toBe(1);
  });
});
