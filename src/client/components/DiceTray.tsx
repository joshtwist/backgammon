import { motion } from "framer-motion";
import { RotateCcw, Check } from "lucide-react";
import type { Move } from "../../shared/types.ts";
import type { StateMessage, ClientMessage } from "../../shared/protocol.ts";
import { remainingDice } from "../../shared/engine/moves.ts";
import { vibrateAction } from "../lib/haptics.ts";
import { DieFace } from "./Dice.tsx";

interface DiceTrayProps {
  state: StateMessage;
  send: (msg: ClientMessage) => void;
  staged: Move[];
  canConfirm: boolean;
  remaining: number;
  onUndo: () => void;
  onConfirm: () => void;
}

/**
 * The bottom control strip: roll button / dice faces with spent-state /
 * undo + confirm. Exactly one primary action is available at any moment,
 * so the player never has to hunt.
 */
export function DiceTray({
  state,
  send,
  staged,
  canConfirm,
  remaining,
  onUndo,
  onConfirm,
}: DiceTrayProps) {
  const you = state.you;
  const turn = state.turn;
  if (!turn) return null;

  const isMyTurn = turn.color === you.color;
  const opponent = state.players.find((p) => p.playerId !== you.playerId);

  // ── My roll phase: one big pulsing button ─────────────────────────
  if (turn.phase === "roll" && isMyTurn) {
    return (
      <div className="flex items-center justify-center py-2">
        <button
          data-testid="roll-btn"
          onClick={() => {
            vibrateAction();
            send({ type: "roll_dice" });
          }}
          className="relative w-full max-w-xs py-4 bg-gold hover:bg-amber-400 active:bg-amber-500 text-slate-900 font-bold text-lg rounded-2xl shadow-lg shadow-gold/30 cursor-pointer"
        >
          {/* Pulse a ring child, not the button — keeps the hit box stable. */}
          <motion.span
            aria-hidden
            animate={{ scale: [1, 1.05, 1], opacity: [0.6, 0, 0.6] }}
            transition={{ repeat: Infinity, duration: 1.3 }}
            className="absolute inset-0 rounded-2xl border-2 border-gold pointer-events-none"
          />
          Roll Dice
        </button>
      </div>
    );
  }

  // ── Waiting for the opponent to roll ──────────────────────────────
  if (turn.phase === "roll" && !isMyTurn) {
    return (
      <div className="flex items-center justify-center gap-3 py-3 text-slate-400">
        <DieFace value={null} size="md" />
        <DieFace value={null} size="md" />
        <span className="text-sm" data-testid="turn-status">
          Waiting for {opponent?.name ?? "opponent"} to roll...
        </span>
      </div>
    );
  }

  const dice = turn.dice;
  if (!dice) return null;

  // Expand doubles to four dice; mark which are spent by staged moves.
  const pool: number[] =
    dice[0] === dice[1] ? [dice[0], dice[0], dice[0], dice[0]] : [...dice];
  const left = isMyTurn ? remainingDice(dice, staged) : [...pool];
  const spentFlags = pool.map(() => true);
  for (const die of left) {
    const idx = spentFlags.findIndex((s, i) => s && pool[i] === die);
    if (idx !== -1) spentFlags[idx] = false;
  }

  // ── No legal moves: the server auto-passes shortly ────────────────
  if (turn.phase === "no_moves") {
    return (
      <div className="flex items-center justify-center gap-3 py-3">
        {pool.map((d, i) => (
          <DieFace key={i} value={d} size="md" animateIn />
        ))}
        <span
          className="text-sm font-semibold text-gold"
          data-testid="no-moves-banner"
        >
          {isMyTurn ? "No legal moves!" : `${turn.color} is blocked!`}
        </span>
      </div>
    );
  }

  // ── Opponent is moving ─────────────────────────────────────────────
  if (!isMyTurn) {
    return (
      <div className="flex items-center justify-center gap-3 py-3 text-slate-400">
        {pool.map((d, i) => (
          <DieFace key={i} value={d} size="md" animateIn />
        ))}
        <span className="text-sm" data-testid="turn-status">
          {opponent?.name ?? "Opponent"} is moving...
        </span>
      </div>
    );
  }

  // ── My move phase: dice + undo/confirm ────────────────────────────
  return (
    <div className="flex items-center justify-between gap-2 py-2">
      <button
        data-testid="undo-btn"
        onClick={onUndo}
        disabled={staged.length === 0}
        aria-label="Undo move"
        className="p-3 rounded-xl bg-slate-800 border border-slate-700 text-white disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer hover:bg-slate-700 transition-colors"
      >
        <RotateCcw className="w-5 h-5" />
      </button>

      <div className="flex items-center gap-2" data-testid="dice-tray">
        {pool.map((d, i) => (
          <DieFace
            key={`${state.turnNumber}-${i}`}
            value={d}
            size="md"
            spent={spentFlags[i]}
            animateIn
          />
        ))}
      </div>

      <button
        data-testid="confirm-btn"
        onClick={() => {
          vibrateAction();
          onConfirm();
        }}
        disabled={!canConfirm}
        className={`px-4 py-3 rounded-xl font-bold flex items-center gap-1.5 transition-colors cursor-pointer disabled:cursor-not-allowed ${
          canConfirm
            ? "bg-gold hover:bg-amber-400 text-slate-900 shadow-lg shadow-gold/30"
            : "bg-slate-800 border border-slate-700 text-slate-500"
        }`}
      >
        <Check className="w-5 h-5" />
        {canConfirm ? "Confirm" : `${remaining} left`}
      </button>
    </div>
  );
}
