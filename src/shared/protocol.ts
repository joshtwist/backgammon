import type {
  BoardState,
  Color,
  DicePair,
  Die,
  GamePhase,
  LastTurn,
  Move,
  PlayerIcon,
  Series,
  TurnPhase,
  WinKind,
} from "./types.ts";

// ── Client → Server ────────────────────────────────────────────────

export type ClientMessage =
  | JoinMessage
  | ReconnectMessage
  | StartGameMessage
  | RollOpeningMessage
  | RollDiceMessage
  | PreviewMovesMessage
  | ConfirmMovesMessage
  | CreateRematchMessage
  | PingMessage
  | TestForceRollsMessage
  | TestSetPositionMessage;

export interface JoinMessage {
  type: "join";
  playerId: string;
  name: string;
  icon: PlayerIcon;
}

export interface ReconnectMessage {
  type: "reconnect";
  playerId: string;
}

export interface StartGameMessage {
  type: "start_game";
}

/** Roll my single opening die (phase "opening"). */
export interface RollOpeningMessage {
  type: "roll_opening";
}

/** Roll both dice at the start of my turn (turn phase "roll"). */
export interface RollDiceMessage {
  type: "roll_dice";
}

/**
 * Live preview of my in-progress (unconfirmed) staged moves, sent on every
 * stage/undo so the opponent can watch my turn unfold. The server relays
 * it ephemerally (never applied to authoritative state) and it's cleared
 * the moment the turn actually changes.
 */
export interface PreviewMovesMessage {
  type: "preview_moves";
  moves: Move[];
}

/**
 * Commit my whole turn as an ordered move sequence. The server validates
 * it atomically against the rules (including forced-play maximality) and
 * either applies it or rejects with an error message.
 */
export interface ConfirmMovesMessage {
  type: "confirm_moves";
  moves: Move[];
}

/**
 * Sent from the GameComplete screen when a player opens a rematch.
 * The server generates a new gameId, seeds the new game's Durable Object
 * with the running series score, and attaches the pointer to this
 * game's state so all connected clients see the rematch CTA.
 */
export interface CreateRematchMessage {
  type: "create_rematch";
}

export interface PingMessage {
  type: "ping";
}

/**
 * TEST-ONLY. Queues the next die values the server will "roll" (consumed
 * in order by opening rolls and turn rolls alike). Lets the e2e suite
 * play deterministic games. Ignored unless the worker runs with
 * TEST_HOOKS=1 (dev only, see .dev.vars).
 */
export interface TestForceRollsMessage {
  type: "_test_force_rolls";
  rolls: Die[];
}

/**
 * TEST-ONLY. Replaces the board mid-game and hands the turn to `turnColor`
 * in the roll phase. Used to set up bear-off/win scenarios without playing
 * out a full game. Gated by TEST_HOOKS like _test_force_rolls.
 */
export interface TestSetPositionMessage {
  type: "_test_set_position";
  board: BoardState;
  turnColor: Color;
}

// ── Server → Client ────────────────────────────────────────────────

export type ServerMessage =
  | StateMessage
  | LobbyInfoMessage
  | ErrorMessage
  | PlayerReconnectedMessage
  | PlayerDisconnectedMessage
  | GameCompleteMessage
  | PongMessage;

/**
 * Sent to any WebSocket whose playerId is NOT (yet) part of the game.
 * Lets the join form know which names/icons are already taken.
 */
export interface LobbyInfoMessage {
  type: "lobby_info";
  phase: GamePhase;
  players: {
    playerId: string;
    name: string;
    icon: PlayerIcon;
  }[];
}

export interface PlayerView {
  playerId: string;
  name: string;
  icon: PlayerIcon;
  color: Color;
  connected: boolean;
}

export interface SelfView {
  playerId: string;
  name: string;
  icon: PlayerIcon;
  color: Color;
  isCreator: boolean;
}

export interface RematchInfoView {
  gameId: string;
  creatorId: string;
  creatorName: string;
}

export interface OpeningView {
  /** Opponent's die is visible too — both roll in the open. */
  rolls: { white: Die | null; black: Die | null };
  lastTie: Die | null;
  tieCount: number;
}

export interface TurnView {
  color: Color;
  phase: TurnPhase;
  dice: DicePair | null;
  maxPlayable: number;
  forcedDie: Die | null;
  /**
   * The current player's in-progress staged moves (their own numbering),
   * relayed live so the opponent sees the turn unfold. Empty when nothing
   * is staged. Never authoritative — the board only changes on confirm.
   */
  preview: Move[];
}

/**
 * The personalized full snapshot every player receives after every
 * mutation. Backgammon is a perfect-information game, so the whole board
 * goes to both players; only `you` differs per recipient.
 */
export interface StateMessage {
  type: "state";
  phase: GamePhase;
  you: SelfView;
  players: PlayerView[];
  board: BoardState;
  opening: OpeningView | null;
  turn: TurnView | null;
  /** Increments on every roll; clients drop staged moves when it changes. */
  turnNumber: number;
  /** The previous player's completed turn ([] moves = danced). */
  lastTurn: LastTurn | null;
  series: Series;
  /** True when this game continues a series (was seeded by a rematch). */
  seeded: boolean;
  /**
   * Present on completed games once any player has opened a rematch.
   * When it flips from null to an object, the win screen swaps its CTA
   * from "Play Again" to "Join {creatorName}'s Next Game".
   */
  rematch: RematchInfoView | null;
}

export interface ErrorMessage {
  type: "error";
  message: string;
}

export interface PlayerReconnectedMessage {
  type: "player_reconnected";
  playerId: string;
}

export interface PlayerDisconnectedMessage {
  type: "player_disconnected";
  playerId: string;
}

export interface GameCompleteMessage {
  type: "game_complete";
  winnerId: string;
  winnerName: string;
  winnerColor: Color;
  kind: WinKind;
  points: 1 | 2 | 3;
  series: Series;
  celebrationGif: string;
}

export interface PongMessage {
  type: "pong";
}
