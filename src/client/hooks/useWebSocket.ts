import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientMessage, ServerMessage } from "../../shared/protocol.ts";

const MAX_RECONNECT_ATTEMPTS = 3;

/**
 * Manages a single WebSocket connection to the game room.
 *
 * The URL always carries `playerId` so the server can tag the socket from
 * the moment it's accepted. Auto-reconnects with exponential backoff, but
 * caps at {@link MAX_RECONNECT_ATTEMPTS} tries to avoid burning cost on a
 * doomed connection (bad URL, server down, etc). After the cap, a
 * `failed` flag is surfaced so the UI can render a manual-retry button.
 *
 * `onMessage` is called directly from `ws.onmessage` for every non-pong
 * server message. This avoids the React-batching trap where an
 * intermediate `lastMessage` state silently drops messages when two
 * arrive in the same tick (e.g. a `state` and a `game_complete` sent in
 * the same broadcast).
 */
export function useWebSocket(
  gameId: string,
  playerId: string,
  onMessage: (msg: ServerMessage) => void,
) {
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);

  // Stable ref so the latest callback is always called without
  // needing it in the `connect` dependency array (which would cause
  // reconnections on every render).
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  const [connected, setConnected] = useState(false);
  const [failed, setFailed] = useState(false);

  const send = useCallback((msg: ClientMessage) => {
    const ws = socketRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }, []);

  const connect = useCallback(() => {
    if (!mountedRef.current) return;

    if (socketRef.current) {
      socketRef.current.onclose = null;
      socketRef.current.close();
    }

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${protocol}//${window.location.host}/api/game/${gameId}/ws?playerId=${encodeURIComponent(playerId)}`;
    const ws = new WebSocket(url);
    socketRef.current = ws;

    ws.onopen = () => {
      if (!mountedRef.current) return;
      setConnected(true);
      setFailed(false);
      reconnectAttemptRef.current = 0;

      if (pingTimerRef.current) clearInterval(pingTimerRef.current);
      pingTimerRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "ping" }));
        }
      }, 10_000);

      // Dev-only escape hatch for e2e tests. Lets Playwright dispatch
      // hidden test messages (`_test_force_rolls`, `_test_set_position`)
      // to set up scenarios that random dice can't reliably reach.
      if (import.meta.env.DEV) {
        (window as unknown as { __ws?: WebSocket }).__ws = ws;
      }
    };

    ws.onmessage = (event) => {
      if (!mountedRef.current) return;
      try {
        const msg = JSON.parse(event.data) as ServerMessage;
        if (msg.type === "pong") return;
        onMessageRef.current(msg);
      } catch {
        // Invalid JSON -- ignore
      }
    };

    ws.onclose = () => {
      if (!mountedRef.current) return;
      setConnected(false);
      if (pingTimerRef.current) {
        clearInterval(pingTimerRef.current);
        pingTimerRef.current = null;
      }

      // Cap reconnects to avoid infinite retry loops (cost concern)
      if (reconnectAttemptRef.current >= MAX_RECONNECT_ATTEMPTS) {
        setFailed(true);
        return;
      }

      const delay = Math.min(
        1000 * Math.pow(2, reconnectAttemptRef.current),
        10_000,
      );
      reconnectAttemptRef.current += 1;
      reconnectTimerRef.current = setTimeout(connect, delay);
    };

    ws.onerror = () => {
      // onclose fires after; reconnect logic runs there
    };
  }, [gameId, playerId]);

  /** Manual retry for after the reconnect cap has been hit. */
  const retry = useCallback(() => {
    reconnectAttemptRef.current = 0;
    setFailed(false);
    connect();
  }, [connect]);

  useEffect(() => {
    mountedRef.current = true;
    connect();

    return () => {
      mountedRef.current = false;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (pingTimerRef.current) clearInterval(pingTimerRef.current);
      if (socketRef.current) {
        socketRef.current.onclose = null;
        socketRef.current.close();
      }
    };
  }, [connect]);

  return { send, connected, failed, retry };
}
