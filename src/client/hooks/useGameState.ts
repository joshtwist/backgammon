import { useCallback, useEffect, useRef, useState } from "react";
import type {
  GameCompleteMessage,
  LobbyInfoMessage,
  ServerMessage,
  StateMessage,
} from "../../shared/protocol.ts";

interface ClientGameState {
  state: StateMessage | null;
  gameComplete: GameCompleteMessage | null;
  lobbyInfo: LobbyInfoMessage | null;
  error: string | null;
}

/**
 * Manages client-side game state derived from server messages.
 *
 * Returns a stable `processMessage` callback that should be called
 * directly from the WebSocket `onmessage` handler — NOT via an
 * intermediate `lastMessage` state. Using a state intermediary loses
 * messages when React batches rapid-fire updates (e.g. the server
 * sends both a `state` and `game_complete` message in the same
 * broadcast). Functional `setGameState(prev => ...)` updates are
 * immune to batching because each updater runs against the latest
 * state, in order.
 */
export function useGameState() {
  const [gameState, setGameState] = useState<ClientGameState>({
    state: null,
    gameComplete: null,
    lobbyInfo: null,
    error: null,
  });

  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cleanup error timer on unmount
  useEffect(() => {
    return () => {
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    };
  }, []);

  const processMessage = useCallback((msg: ServerMessage) => {
    switch (msg.type) {
      case "state":
        setGameState((prev) => ({
          ...prev,
          state: msg,
          // A fresh game (rematch navigation reuses the hook) must not
          // keep a stale win screen around.
          gameComplete: msg.phase === "complete" ? prev.gameComplete : null,
        }));
        break;

      case "lobby_info":
        setGameState((prev) => ({
          ...prev,
          lobbyInfo: msg,
        }));
        break;

      case "game_complete":
        setGameState((prev) => ({
          ...prev,
          gameComplete: msg,
        }));
        break;

      case "error":
        if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
        setGameState((prev) => ({
          ...prev,
          error: msg.message,
        }));
        errorTimerRef.current = setTimeout(() => {
          setGameState((prev) => ({ ...prev, error: null }));
        }, 3000);
        break;

      case "player_reconnected":
        setGameState((prev) => {
          if (!prev.state) return prev;
          return {
            ...prev,
            state: {
              ...prev.state,
              players: prev.state.players.map((p) =>
                p.playerId === msg.playerId ? { ...p, connected: true } : p,
              ),
            },
          };
        });
        break;

      case "player_disconnected":
        setGameState((prev) => {
          if (!prev.state) return prev;
          return {
            ...prev,
            state: {
              ...prev.state,
              players: prev.state.players.map((p) =>
                p.playerId === msg.playerId ? { ...p, connected: false } : p,
              ),
            },
          };
        });
        break;
    }
  }, []);

  return { ...gameState, processMessage };
}
