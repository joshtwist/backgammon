// ── Player identity ────────────────────────────────────────────────

export const PLAYER_ICONS = [
  "cat",
  "dog",
  "bird",
  "fish",
  "rabbit",
  "snail",
  "bug",
  "flame",
  "zap",
  "star",
  "moon",
  "sun",
  "heart",
  "skull",
  "ghost",
  "rocket",
  "crown",
  "gem",
  "anchor",
  "gamepad-2",
] as const;

export type PlayerIcon = (typeof PLAYER_ICONS)[number];

export const MAX_PLAYERS = 2;

export type Color = "white" | "black";

export interface Player {
  playerId: string;
  name: string;
  icon: PlayerIcon;
  color: Color;
  connected: boolean;
}

// ── Board ──────────────────────────────────────────────────────────
//
// Each color's checkers are indexed from THAT PLAYER'S OWN perspective:
//   index 1..24  = points, where 1-6 is the player's home board and the
//                  player always moves from high numbers toward low ones
//   index OFF(0) = checkers borne off
//   index BAR(25)= checkers on the bar
//
// The two views describe one physical board via the mirror rule:
//   my point p is the opponent's point 25-p
// so the opponent's occupancy of my point p is `board[opp][25 - p]`.
//
// This makes movement arithmetic uniform for both colors:
//   destination = max(from - die, 0)
// which also covers bar entry (from=25 lands on 25-die, inside the
// opponent's home board 19..24) and bearing off (destination 0 = OFF).

export const OFF = 0;
export const BAR = 25;

export type Die = 1 | 2 | 3 | 4 | 5 | 6;

/** The two dice of a roll. Doubles appear as two equal values. */
export type DicePair = [Die, Die];

export interface BoardState {
  /** 26 counts indexed by white's own point numbering; sums to 15. */
  white: number[];
  /** 26 counts indexed by black's own point numbering; sums to 15. */
  black: number[];
}

/**
 * A single checker movement using one die. `from` is in the mover's own
 * numbering (1..24, or BAR). The destination is derived:
 * `max(from - die, 0)` — 0 means borne off.
 */
export interface Move {
  from: number;
  die: Die;
}

// ── Game flow ──────────────────────────────────────────────────────

export type GamePhase = "lobby" | "opening" | "playing" | "complete";

export type TurnPhase = "roll" | "move" | "no_moves";

export interface TurnState {
  color: Color;
  phase: TurnPhase;
  /** null while waiting for the roll. */
  dice: DicePair | null;
  /** How many dice can legally be played this turn (0..4). */
  maxPlayable: number;
  /**
   * When exactly one of two different dice can be played, the rules force
   * which one (the higher, if it has any legal move). null otherwise.
   */
  forcedDie: Die | null;
}

/** The last completed turn — lets clients animate the opponent's play. */
export interface LastTurn {
  color: Color;
  dice: DicePair;
  /** Empty array = the player danced (no legal moves). */
  moves: Move[];
  /** How many of the OPPONENT's checkers this turn sent to the bar. */
  hits: number;
}

export interface OpeningState {
  rolls: { white: Die | null; black: Die | null };
  /** Value of the most recent tied opening roll, for the "tie!" banner. */
  lastTie: Die | null;
  tieCount: number;
}

export type WinKind = "single" | "gammon" | "backgammon";

export const WIN_POINTS: Record<WinKind, 1 | 2 | 3> = {
  single: 1,
  gammon: 2,
  backgammon: 3,
};

export interface WinnerInfo {
  playerId: string;
  color: Color;
  kind: WinKind;
  points: 1 | 2 | 3;
}

// ── Series (running score across rematches) ────────────────────────

export interface Series {
  white: number;
  black: number;
  /** Completed games in the series, including this one once it ends. */
  gamesPlayed: number;
}

export interface SeriesSeedEntry {
  name: string;
  icon: PlayerIcon;
  color: Color;
  score: number;
}

/**
 * Pushed DO-to-DO when a rematch is created, so the new game starts with
 * the running series score. Players are matched by name+icon when they
 * join (playerIds are per-game and can't carry over).
 */
export interface SeriesSeed {
  fromGameId: string;
  gamesPlayed: number;
  entries: SeriesSeedEntry[];
}

export interface RematchInfo {
  gameId: string;
  creatorId: string;
  creatorName: string;
}
