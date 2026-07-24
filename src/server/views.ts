import type { Move } from "../shared/types.ts";
import type { GameState } from "../shared/engine/game.ts";
import type {
  GameCompleteMessage,
  LobbyInfoMessage,
  StateMessage,
} from "../shared/protocol.ts";

/**
 * The personalized snapshot for one player. `preview` is the current
 * player's live, unconfirmed staged moves, relayed so the opponent can
 * watch the turn unfold; it's ephemeral and never part of the board.
 */
export function getPlayerView(
  state: GameState,
  playerId: string,
  preview: Move[] = [],
): StateMessage {
  const self = state.players.find((p) => p.playerId === playerId);
  if (!self) {
    throw new Error("Player not found");
  }

  return {
    type: "state",
    phase: state.phase,
    you: {
      playerId: self.playerId,
      name: self.name,
      icon: self.icon,
      color: self.color,
      isCreator: self.playerId === state.creatorId,
    },
    players: state.players.map((p) => ({
      playerId: p.playerId,
      name: p.name,
      icon: p.icon,
      color: p.color,
      connected: p.connected,
    })),
    board: state.board,
    opening: state.opening,
    turn: state.turn
      ? { ...state.turn, preview: state.turn.phase === "move" ? preview : [] }
      : null,
    turnNumber: state.turnNumber,
    lastTurn: state.lastTurn,
    series: state.series,
    seeded: state.seed !== null,
    rematch: state.rematch,
  };
}

/** What non-player sockets (join form viewers) receive. */
export function lobbyInfo(state: GameState): LobbyInfoMessage {
  return {
    type: "lobby_info",
    phase: state.phase,
    players: state.players.map((p) => ({
      playerId: p.playerId,
      name: p.name,
      icon: p.icon,
    })),
  };
}

export function buildCompleteMessage(
  state: GameState,
): GameCompleteMessage | null {
  if (state.phase !== "complete" || !state.winner || !state.celebrationGif) {
    return null;
  }
  const winner = state.players.find(
    (p) => p.playerId === state.winner?.playerId,
  );
  return {
    type: "game_complete",
    winnerId: state.winner.playerId,
    winnerName: winner?.name ?? "Winner",
    winnerColor: state.winner.color,
    kind: state.winner.kind,
    points: state.winner.points,
    series: state.series,
    celebrationGif: state.celebrationGif,
  };
}
