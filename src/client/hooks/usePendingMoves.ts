import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { OFF } from "../../shared/types.ts";
import type { Color, Move } from "../../shared/types.ts";
import type { ClientMessage, StateMessage } from "../../shared/protocol.ts";
import { applyMoves, moveDest } from "../../shared/engine/board.ts";
import { legalNextMoves, remainingDice } from "../../shared/engine/moves.ts";

/**
 * Client-local staging of the current turn.
 *
 * Nothing is sent to the server until `confirm()`. The hook derives the
 * displayed board by applying staged moves to the authoritative board,
 * exposes which points may be dragged next (via the shared engine's
 * dead-end-proof `legalNextMoves`), and clears itself whenever the
 * server bumps `turnNumber` (new roll = new turn = stale staging).
 */
export function usePendingMoves(
  state: StateMessage,
  send: (msg: ClientMessage) => void,
) {
  const you = state.you;
  const turn = state.turn;
  const isMyTurn = state.phase === "playing" && turn?.color === you.color;
  const isMyMove = isMyTurn && turn?.phase === "move" && turn.dice !== null;

  const [staged, setStaged] = useState<Move[]>([]);
  const confirmedTurnRef = useRef<number | null>(null);

  // New roll (or test-hook board swap) invalidates any staged moves.
  useEffect(() => {
    setStaged([]);
  }, [state.turnNumber]);

  const board = state.board;
  const dice = turn?.dice ?? null;

  // The opponent's live, unconfirmed staged moves (their own numbering),
  // relayed by the server so we can watch their turn unfold.
  const opponentPreview = !isMyTurn && turn ? turn.preview : [];
  const previewColor: Color | null =
    !isMyTurn && turn && opponentPreview.length > 0 ? turn.color : null;

  /**
   * The board as the player currently sees it: my own staged moves on my
   * turn, or the opponent's live preview on theirs.
   */
  const displayBoard = useMemo(() => {
    try {
      if (isMyMove && staged.length > 0) {
        return applyMoves(board, you.color, staged);
      }
      if (previewColor && opponentPreview.length > 0) {
        return applyMoves(board, previewColor, opponentPreview);
      }
    } catch {
      // A malformed preview should never break the board render.
    }
    return board;
  }, [board, staged, isMyMove, you.color, previewColor, opponentPreview]);

  // Send my staged moves to the server on every change so the opponent
  // sees them live. Only while it's actually my move.
  const lastSentRef = useRef<string>("");
  useEffect(() => {
    if (!isMyMove) return;
    const key = JSON.stringify(staged);
    if (key === lastSentRef.current) return;
    lastSentRef.current = key;
    send({ type: "preview_moves", moves: staged });
  }, [staged, isMyMove, send]);

  /** Legal next single moves given what's already staged. */
  const nextMoves = useMemo(() => {
    if (!isMyMove || !dice) return [];
    return legalNextMoves(board, you.color, dice, staged);
  }, [board, dice, staged, isMyMove, you.color]);

  /** Points (own numbering, incl. BAR) the player may pick up from. */
  const draggableSources = useMemo(
    () => new Set(nextMoves.map((m) => m.from)),
    [nextMoves],
  );

  /**
   * All destinations reachable from `from`, including multi-hop chains
   * where one checker uses several dice (e.g. 24/13 with a 6-5). Returns
   * a map dest -> the move sequence that gets there. Single hops win over
   * chains to the same square; for bear-off with a choice of dice, the
   * exact die wins, then the larger.
   */
  const targetsFor = useCallback(
    (from: number): Map<number, Move[]> => {
      const out = new Map<number, Move[]>();
      if (!isMyMove || !dice) return out;

      const better = (a: Move[], b: Move[] | undefined): boolean => {
        if (!b) return true;
        if (a.length !== b.length) return a.length < b.length;
        const [ma] = a.slice(-1);
        const [mb] = b.slice(-1);
        // Bear-off tie-break: exact die first, then the larger die.
        if (moveDest(ma) === OFF && moveDest(mb) === OFF) {
          const exactA = ma.from === ma.die;
          const exactB = mb.from === mb.die;
          if (exactA !== exactB) return exactA;
        }
        return ma.die > mb.die;
      };

      const walk = (stagedSoFar: Move[], cur: number, path: Move[]) => {
        if (path.length >= 4) return;
        const options = legalNextMoves(
          board,
          you.color,
          dice,
          stagedSoFar,
        ).filter((m) => m.from === cur);
        for (const move of options) {
          const dest = moveDest(move);
          const newPath = [...path, move];
          if (better(newPath, out.get(dest))) {
            out.set(dest, newPath);
          }
          if (dest !== OFF) {
            walk([...stagedSoFar, move], dest, newPath);
          }
        }
      };

      walk(staged, from, []);
      return out;
    },
    [board, dice, staged, isMyMove, you.color],
  );

  const stage = useCallback(
    (sequence: Move[]) => {
      setStaged((prev) => {
        // Reject a sequence that no longer fits the remaining dice (e.g.
        // a duplicate drop event) instead of corrupting the staging and
        // crashing downstream memos.
        if (!dice) return prev;
        try {
          remainingDice(dice, [...prev, ...sequence]);
        } catch {
          return prev;
        }
        return [...prev, ...sequence];
      });
    },
    [dice],
  );

  const undo = useCallback(() => {
    setStaged((prev) => prev.slice(0, -1));
  }, []);

  const maxPlayable = turn?.maxPlayable ?? 0;
  const canConfirm =
    isMyMove &&
    staged.length === maxPlayable &&
    confirmedTurnRef.current !== state.turnNumber;

  const confirm = useCallback(() => {
    if (!canConfirm) return;
    confirmedTurnRef.current = state.turnNumber;
    send({ type: "confirm_moves", moves: staged });
  }, [canConfirm, send, staged, state.turnNumber]);

  // A server rejection leaves turnNumber unchanged but should re-enable
  // Confirm. Cheap approach: any error message re-arms the guard.
  useEffect(() => {
    confirmedTurnRef.current = null;
  }, [staged]);

  return {
    staged,
    displayBoard,
    draggableSources,
    targetsFor,
    stage,
    undo,
    confirm,
    canConfirm,
    remaining: Math.max(0, maxPlayable - staged.length),
    isMyTurn,
    isMyMove,
    /** Opponent's live staged moves (their own numbering) + their color,
     *  for glowing the in-progress pieces on the watcher's screen. */
    opponentPreview,
    previewColor,
  };
}
