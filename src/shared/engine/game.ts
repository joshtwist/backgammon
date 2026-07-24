import { BAR, MAX_PLAYERS, OFF, WIN_POINTS } from "../types.ts";
import type {
  BoardState,
  Color,
  DicePair,
  Die,
  GamePhase,
  LastTurn,
  Move,
  OpeningState,
  Player,
  PlayerIcon,
  RematchInfo,
  Series,
  SeriesSeed,
  TurnState,
  WinKind,
  WinnerInfo,
} from "../types.ts";
import { mirror, other, startBoard } from "./board.ts";
import { analyzeRoll, validateTurn } from "./moves.ts";

export interface GameState {
  gameId: string;
  phase: GamePhase;
  players: Player[];
  /** First joiner; the only one who can start the game. */
  creatorId: string;
  board: BoardState;
  opening: OpeningState | null;
  turn: TurnState | null;
  /** Increments every roll; clients discard staged moves when it changes. */
  turnNumber: number;
  lastTurn: LastTurn | null;
  winner: WinnerInfo | null;
  series: Series;
  /** Present when this game was created as a rematch; used to keep each
   * returning player on their previous color and score. */
  seed: SeriesSeed | null;
  rematch: RematchInfo | null;
  celebrationGif: string | null;
}

// ── Creation & lobby ───────────────────────────────────────────────

export function createGame(gameId: string): GameState {
  return {
    gameId,
    phase: "lobby",
    players: [],
    creatorId: "",
    board: startBoard(),
    opening: null,
    turn: null,
    turnNumber: 0,
    lastTurn: null,
    winner: null,
    series: { white: 0, black: 0, gamesPlayed: 0 },
    seed: null,
    rematch: null,
    celebrationGif: null,
  };
}

/** Create a rematch game carrying the series score from a finished game. */
export function seedGame(gameId: string, seed: SeriesSeed): GameState {
  const state = createGame(gameId);
  const scoreFor = (color: Color): number =>
    seed.entries.find((e) => e.color === color)?.score ?? 0;
  return {
    ...state,
    seed,
    series: {
      white: scoreFor("white"),
      black: scoreFor("black"),
      gamesPlayed: seed.gamesPlayed,
    },
  };
}

function pickColor(state: GameState, name: string, icon: PlayerIcon): Color {
  const taken = new Set(state.players.map((p) => p.color));
  if (state.seed) {
    const entry = state.seed.entries.find(
      (e) => e.name === name && e.icon === icon,
    );
    if (entry && !taken.has(entry.color)) return entry.color;
  }
  return taken.has("white") ? "black" : "white";
}

export function addPlayer(
  state: GameState,
  playerId: string,
  name: string,
  icon: PlayerIcon,
): GameState {
  if (state.phase !== "lobby") {
    throw new Error("Cannot join: the game has already started");
  }
  if (state.players.length >= MAX_PLAYERS) {
    throw new Error("Cannot join: the game is full");
  }
  if (state.players.some((p) => p.playerId === playerId)) {
    throw new Error("You have already joined this game");
  }
  if (state.players.some((p) => p.icon === icon)) {
    throw new Error("That icon is already taken");
  }

  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error("Please enter a name");
  }

  const color = pickColor(state, trimmed, icon);
  const player: Player = {
    playerId,
    name: trimmed,
    icon,
    color,
    connected: true,
  };

  // If a seeded seat is taken over by a different identity, that seat's
  // carried score no longer belongs to anyone playing — zero it.
  let series = state.series;
  if (state.seed) {
    const entry = state.seed.entries.find((e) => e.color === color);
    if (entry && (entry.name !== trimmed || entry.icon !== icon)) {
      series = { ...series, [color]: 0 };
    }
  }

  return {
    ...state,
    players: [...state.players, player],
    creatorId: state.creatorId || playerId,
    series,
  };
}

export function setPlayerConnected(
  state: GameState,
  playerId: string,
  connected: boolean,
): GameState {
  return {
    ...state,
    players: state.players.map((p) =>
      p.playerId === playerId ? { ...p, connected } : p,
    ),
  };
}

// ── Starting & the opening roll ────────────────────────────────────

export function startGame(state: GameState, playerId: string): GameState {
  if (state.phase !== "lobby") {
    throw new Error("The game has already started");
  }
  if (playerId !== state.creatorId) {
    throw new Error("Only the game creator can start the game");
  }
  if (state.players.length !== MAX_PLAYERS) {
    throw new Error("Backgammon needs exactly 2 players");
  }

  return {
    ...state,
    phase: "opening",
    board: startBoard(),
    opening: { rolls: { white: null, black: null }, lastTie: null, tieCount: 0 },
    turn: null,
    turnNumber: 0,
    lastTurn: null,
    winner: null,
  };
}

function playerByIdOrThrow(state: GameState, playerId: string): Player {
  const player = state.players.find((p) => p.playerId === playerId);
  if (!player) throw new Error("You are not a player in this game");
  return player;
}

/**
 * One player rolls their opening die. When both have rolled: the higher
 * roller moves first and plays BOTH dice as their opening roll; a tie
 * re-arms both dice (and is surfaced via lastTie/tieCount).
 */
export function rollOpeningDie(
  state: GameState,
  playerId: string,
  die: Die,
): GameState {
  if (state.phase !== "opening" || !state.opening) {
    throw new Error("Not waiting for an opening roll");
  }
  const player = playerByIdOrThrow(state, playerId);
  if (state.opening.rolls[player.color] !== null) {
    throw new Error("You have already rolled");
  }

  const rolls = { ...state.opening.rolls, [player.color]: die };
  const { white, black } = rolls;

  if (white === null || black === null) {
    return { ...state, opening: { ...state.opening, rolls } };
  }

  if (white === black) {
    return {
      ...state,
      opening: {
        rolls: { white: null, black: null },
        lastTie: white,
        tieCount: state.opening.tieCount + 1,
      },
    };
  }

  const winner: Color = white > black ? "white" : "black";
  const dice: DicePair = winner === "white" ? [white, black] : [black, white];
  const analysis = analyzeRoll(state.board, winner, dice);

  return {
    ...state,
    phase: "playing",
    opening: null,
    turnNumber: 1,
    turn: {
      color: winner,
      // A dance on turn 1 is impossible from the start position, but the
      // generic no_moves path keeps this honest anyway.
      phase: analysis.maxPlayable === 0 ? "no_moves" : "move",
      dice,
      maxPlayable: analysis.maxPlayable,
      forcedDie: analysis.forcedDie,
    },
  };
}

// ── Turns ──────────────────────────────────────────────────────────

function activePlayerOrThrow(state: GameState, playerId: string): TurnState {
  if (state.phase !== "playing" || !state.turn) {
    throw new Error("The game is not in play");
  }
  const player = playerByIdOrThrow(state, playerId);
  if (player.color !== state.turn.color) {
    throw new Error("It is not your turn");
  }
  return state.turn;
}

export function rollDice(
  state: GameState,
  playerId: string,
  dice: DicePair,
): GameState {
  const turn = activePlayerOrThrow(state, playerId);
  if (turn.phase !== "roll") {
    throw new Error("You have already rolled");
  }

  const analysis = analyzeRoll(state.board, turn.color, dice);
  return {
    ...state,
    turnNumber: state.turnNumber + 1,
    turn: {
      ...turn,
      phase: analysis.maxPlayable === 0 ? "no_moves" : "move",
      dice,
      maxPlayable: analysis.maxPlayable,
      forcedDie: analysis.forcedDie,
    },
  };
}

export function confirmTurn(
  state: GameState,
  playerId: string,
  moves: Move[],
): GameState {
  const turn = activePlayerOrThrow(state, playerId);
  if (turn.phase !== "move" || !turn.dice) {
    throw new Error("Roll the dice first");
  }

  const board = validateTurn(state.board, turn.color, turn.dice, moves);
  const foe = other(turn.color);
  const hits = board[foe][BAR] - state.board[foe][BAR];
  const lastTurn: LastTurn = { color: turn.color, dice: turn.dice, moves, hits };

  if (board[turn.color][OFF] === 15) {
    const kind = winKindOf(board, turn.color);
    const points = WIN_POINTS[kind];
    return {
      ...state,
      board,
      lastTurn,
      phase: "complete",
      turn: null,
      winner: { playerId, color: turn.color, kind, points },
      series: {
        ...state.series,
        [turn.color]: state.series[turn.color] + points,
        gamesPlayed: state.series.gamesPlayed + 1,
      },
    };
  }

  return {
    ...state,
    board,
    lastTurn,
    turn: {
      color: other(turn.color),
      phase: "roll",
      dice: null,
      maxPlayable: 0,
      forcedDie: null,
    },
  };
}

/**
 * Server-initiated pass after the "no legal moves" pause. Not exposed as
 * a client message — the DO's alarm calls this.
 */
export function passNoMoves(state: GameState): GameState {
  if (state.phase !== "playing" || !state.turn || !state.turn.dice) {
    throw new Error("Nothing to pass");
  }
  if (state.turn.phase !== "no_moves") {
    throw new Error("The current turn has legal moves");
  }

  return {
    ...state,
    lastTurn: { color: state.turn.color, dice: state.turn.dice, moves: [], hits: 0 },
    turn: {
      color: other(state.turn.color),
      phase: "roll",
      dice: null,
      maxPlayable: 0,
      forcedDie: null,
    },
  };
}

// ── Winning ────────────────────────────────────────────────────────

export function winKindOf(board: BoardState, winner: Color): WinKind {
  const loser = other(winner);
  const loserSide = board[loser];
  if (loserSide[OFF] > 0) return "single";

  // Backgammon: loser still has a checker on the bar or inside the
  // winner's home board. The winner's home (their points 1..6) is the
  // loser's points 19..24 by the mirror rule.
  if (loserSide[BAR] > 0) return "backgammon";
  for (let p = 1; p <= 6; p++) {
    if (loserSide[mirror(p)] > 0) return "backgammon";
  }
  return "gammon";
}

// ── Rematch & series ───────────────────────────────────────────────

export function createRematch(
  state: GameState,
  playerId: string,
  newGameId: string,
): GameState {
  if (state.phase !== "complete") {
    throw new Error("The game is not over yet");
  }
  if (state.rematch) {
    throw new Error("A rematch has already been created");
  }
  const player = playerByIdOrThrow(state, playerId);

  return {
    ...state,
    rematch: {
      gameId: newGameId,
      creatorId: playerId,
      creatorName: player.name,
    },
  };
}

/** Snapshot of the series to seed the next game's Durable Object with. */
export function buildSeed(state: GameState): SeriesSeed {
  return {
    fromGameId: state.gameId,
    gamesPlayed: state.series.gamesPlayed,
    entries: state.players.map((p) => ({
      name: p.name,
      icon: p.icon,
      color: p.color,
      score: state.series[p.color],
    })),
  };
}
