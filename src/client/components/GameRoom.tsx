import { useEffect, useRef, useState } from "react";
import {
  useParams,
  useNavigate,
  useLocation,
  Navigate,
} from "react-router-dom";
import { BAR } from "../../shared/types.ts";
import type { PlayerIcon } from "../../shared/types.ts";
import { getPlayerId, setPlayerId } from "../lib/storage.ts";
import {
  vibrateTurn,
  vibrateError,
  vibrateWin,
  vibrateHit,
} from "../lib/haptics.ts";
import { useWebSocket } from "../hooks/useWebSocket.ts";
import { useGameState } from "../hooks/useGameState.ts";
import { JoinForm } from "./JoinForm.tsx";
import { Lobby } from "./Lobby.tsx";
import { OpeningRoll } from "./OpeningRoll.tsx";
import { GameBoard } from "./GameBoard.tsx";
import { GameComplete } from "./GameComplete.tsx";
import { ErrorToast } from "./ErrorToast.tsx";
import type { RematchInfoView } from "../../shared/protocol.ts";

interface AutoJoin {
  name: string;
  icon: PlayerIcon;
}

/**
 * Top-level container for a single game room.
 *
 * - Ensures a playerId exists for this gameId (generates on first visit).
 * - Manages the WebSocket lifecycle.
 * - Routes to the appropriate child component based on phase.
 * - Handles redirect-on-rematch (with auto-join for the new game).
 * - Drives haptic feedback hooks (turn start, hit, error, win).
 *
 * Owns NO game logic -- pure orchestration.
 */
export function GameRoom() {
  const { gameId } = useParams<{ gameId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const autoJoin = (location.state as { autoJoin?: AutoJoin } | null)
    ?.autoJoin;

  if (!gameId) {
    return <Navigate to="/" replace />;
  }

  // `key={gameId}` forces a clean remount when navigating between rooms
  // (e.g. opening a rematch). Without it, refs like `autoJoinSentRef`
  // persist across navigations and the auto-join into the new game
  // silently no-ops because the OLD game's join was already sent.
  return (
    <GameRoomInner
      key={gameId}
      gameId={gameId}
      navigate={navigate}
      autoJoin={autoJoin}
    />
  );
}

function GameRoomInner({
  gameId,
  navigate,
  autoJoin,
}: {
  gameId: string;
  navigate: ReturnType<typeof useNavigate>;
  autoJoin: AutoJoin | undefined;
}) {
  // Resolve playerId + whether this is a returning player. Computed once.
  const [{ playerId, isReturning }] = useState(() => {
    const stored = getPlayerId(gameId);
    if (stored) {
      return { playerId: stored, isReturning: true };
    }
    const fresh = crypto.randomUUID();
    setPlayerId(gameId, fresh);
    return { playerId: fresh, isReturning: false };
  });

  const { state, gameComplete, lobbyInfo, error, processMessage } =
    useGameState();
  const { send, connected, failed, retry } = useWebSocket(
    gameId,
    playerId,
    processMessage,
  );

  // After connecting, give the server a brief window to send state before we
  // assume this player isn't in the game. Avoids a join-form flash for
  // returning players.
  const [waitedForState, setWaitedForState] = useState(false);
  useEffect(() => {
    if (!connected || state) return;
    const delay = isReturning ? 1500 : 400;
    const t = setTimeout(() => setWaitedForState(true), delay);
    return () => clearTimeout(t);
  }, [connected, state, isReturning]);

  // Reset the wait flag if state arrives
  useEffect(() => {
    if (state) setWaitedForState(false);
  }, [state]);

  // Navigate into a rematch, carrying the player's name + icon so the
  // new room's JoinForm auto-submits. Triggered from the win-screen
  // button (or, for the rematch creator, auto-fired when state.rematch
  // flips from null to set — see GameComplete.tsx).
  function handleJoinRematch(rematch: RematchInfoView) {
    const me = state?.you;
    navigate(`/${rematch.gameId}`, {
      replace: true,
      state: {
        autoJoin: me ? { name: me.name, icon: me.icon } : undefined,
      },
    });
  }

  // Auto-join when we arrive from a rematch redirect
  const autoJoinSentRef = useRef(false);
  useEffect(() => {
    if (!autoJoin) return;
    if (autoJoinSentRef.current) return;
    if (!connected) return;
    if (state?.players.some((p) => p.playerId === playerId)) return;

    autoJoinSentRef.current = true;
    send({
      type: "join",
      playerId,
      name: autoJoin.name,
      icon: autoJoin.icon,
    });
  }, [autoJoin, connected, state, playerId, send]);

  // Haptic: it just became your turn (covers winning the opening roll too)
  const wasMyTurnRef = useRef(false);
  useEffect(() => {
    const isMyTurn =
      state?.phase === "playing" && state.turn?.color === state.you.color;
    if (isMyTurn && !wasMyTurnRef.current) {
      vibrateTurn();
    }
    wasMyTurnRef.current = !!isMyTurn;
  }, [state]);

  // Haptic: one of your checkers was hit (your bar count went up)
  const prevBarRef = useRef(0);
  useEffect(() => {
    if (!state) return;
    const myBar = state.board[state.you.color][BAR];
    if (myBar > prevBarRef.current) {
      vibrateHit();
    }
    prevBarRef.current = myBar;
  }, [state]);

  // Haptic: server error
  useEffect(() => {
    if (error) vibrateError();
  }, [error]);

  // Haptic: you won
  useEffect(() => {
    if (gameComplete && gameComplete.winnerId === playerId) {
      vibrateWin();
    }
  }, [gameComplete, playerId]);

  // ── Render ──────────────────────────────────────────────────────

  // Reconnect attempts exhausted -- show a retry button
  if (failed && !state) {
    return (
      <>
        <ErrorToast message={error} />
        <ConnectionFailedScreen onRetry={retry} />
      </>
    );
  }

  // Not connected yet
  if (!connected && !state && !lobbyInfo) {
    return (
      <>
        <ErrorToast message={error} />
        <LoadingScreen text="Connecting..." />
      </>
    );
  }

  const playerInState =
    state?.players.some((p) => p.playerId === playerId) ?? false;

  if (!state || !playerInState) {
    // Still within the server response window -- show loader to avoid flash.
    // lobbyInfo indicates we're a non-player (server told us so) -> safe to
    // show join form immediately.
    if (!waitedForState && !autoJoin && !lobbyInfo) {
      return (
        <>
          <ErrorToast message={error} />
          <LoadingScreen
            text={isReturning ? "Reconnecting..." : "Loading..."}
          />
        </>
      );
    }

    // Auto-joining from a redirect: show loader while server processes
    if (autoJoin && !autoJoinSentRef.current) {
      return (
        <>
          <ErrorToast message={error} />
          <LoadingScreen text="Rejoining..." />
        </>
      );
    }

    // Derive taken icons from either the player state (if we're already in it)
    // or the lobby_info the server sends to non-player connections.
    const takenIcons =
      state?.players.map((p) => p.icon) ??
      lobbyInfo?.players.map((p) => p.icon) ??
      [];
    return (
      <>
        <ErrorToast message={error} />
        <JoinForm playerId={playerId} send={send} takenIcons={takenIcons} />
      </>
    );
  }

  // In game -- render by phase
  return (
    <>
      <ErrorToast message={error} />
      {state.phase === "lobby" && (
        <Lobby state={state} gameId={gameId} send={send} />
      )}
      {state.phase === "opening" && <OpeningRoll state={state} send={send} />}
      {state.phase === "playing" && <GameBoard state={state} send={send} />}
      {state.phase === "complete" && gameComplete && (
        <GameComplete
          state={state}
          result={gameComplete}
          send={send}
          onJoinRematch={handleJoinRematch}
        />
      )}
      {state.phase === "complete" && !gameComplete && (
        <LoadingScreen text="Finishing game..." />
      )}
    </>
  );
}

function LoadingScreen({ text }: { text: string }) {
  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="text-slate-400" data-testid="loading-screen">
        {text}
      </div>
    </div>
  );
}

function ConnectionFailedScreen({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-1 items-center justify-center px-6">
      <div
        className="flex flex-col items-center gap-4 text-center"
        data-testid="connection-failed"
      >
        <div className="text-slate-200 font-semibold">
          Couldn't connect to the game
        </div>
        <div className="text-slate-400 text-sm max-w-xs">
          Check your link and connection, then try again.
        </div>
        <button
          onClick={onRetry}
          data-testid="retry-btn"
          className="mt-2 px-5 py-2.5 bg-gold hover:bg-amber-400 text-slate-900 font-semibold rounded-xl transition-colors cursor-pointer"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
