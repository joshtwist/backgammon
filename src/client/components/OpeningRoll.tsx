import { motion, AnimatePresence } from "framer-motion";
import type { ClientMessage, StateMessage } from "../../shared/protocol.ts";
import { other } from "../../shared/engine/board.ts";
import { vibrateAction } from "../lib/haptics.ts";
import { DieFace } from "./Dice.tsx";
import { ICON_MAP } from "../lib/icons.ts";

interface OpeningRollProps {
  state: StateMessage;
  send: (msg: ClientMessage) => void;
}

/**
 * The opening roll: each player rolls ONE die in the open; the higher
 * roller goes first and plays both values as their first turn. Ties
 * re-arm both dice (the server resets the rolls and bumps tieCount).
 */
export function OpeningRoll({ state, send }: OpeningRollProps) {
  const you = state.you;
  const opening = state.opening;
  if (!opening) return null;

  const myColor = you.color;
  const oppColor = other(myColor);
  const opponent = state.players.find((p) => p.color === oppColor);
  const myRoll = opening.rolls[myColor];
  const oppRoll = opening.rolls[oppColor];

  function handleRoll() {
    if (myRoll !== null) return;
    vibrateAction();
    send({ type: "roll_opening" });
  }

  const OppIcon = opponent ? ICON_MAP[opponent.icon] : null;

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 gap-10">
      <div className="text-center">
        <h1 className="text-3xl font-bold">Opening Roll</h1>
        <p className="text-slate-400 mt-1">
          Higher die goes first — and plays both numbers
        </p>
      </div>

      <AnimatePresence>
        {opening.lastTie !== null && (
          <motion.div
            key={opening.tieCount}
            initial={{ scale: 0.7, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ opacity: 0 }}
            data-testid="opening-tie"
            className="bg-gold/15 border border-gold/40 text-gold px-4 py-2 rounded-xl font-semibold"
          >
            Double {opening.lastTie}s — it's a tie! Roll again.
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex items-center gap-10">
        {/* Opponent's die */}
        <div className="flex flex-col items-center gap-3">
          <div className="flex items-center gap-2 text-slate-300 text-sm font-medium">
            {OppIcon && <OppIcon className="w-4 h-4" />}
            {opponent?.name ?? "Opponent"}
          </div>
          <DieFace
            value={oppRoll}
            size="lg"
            animateIn={oppRoll !== null}
            testid="opening-die-opponent"
          />
          <div className="text-xs text-slate-500 h-4">
            {oppRoll === null ? "waiting..." : ""}
          </div>
        </div>

        <div className="text-2xl font-bold text-slate-600">vs</div>

        {/* Your die */}
        <div className="flex flex-col items-center gap-3">
          <div className="text-slate-300 text-sm font-medium">You</div>
          {myRoll === null ? (
            <button
              data-testid="opening-roll-btn"
              onClick={handleRoll}
              className="relative w-16 h-16 rounded-xl bg-gold hover:bg-amber-400 text-slate-900 font-bold shadow-lg shadow-gold/30 cursor-pointer"
            >
              {/* Pulse a decorative ring, not the button itself — a scale
                  animation on the button makes its hit box unstable (and
                  trips up both fat thumbs and Playwright). */}
              <motion.span
                aria-hidden
                animate={{ scale: [1, 1.18, 1], opacity: [0.7, 0, 0.7] }}
                transition={{ repeat: Infinity, duration: 1.4 }}
                className="absolute inset-0 rounded-xl border-2 border-gold pointer-events-none"
              />
              Roll
            </button>
          ) : (
            <DieFace
              value={myRoll}
              size="lg"
              animateIn
              testid="opening-die-you"
            />
          )}
          <div className="text-xs text-slate-500 h-4">
            {myRoll !== null && oppRoll === null ? "nice roll" : ""}
          </div>
        </div>
      </div>

      <p className="text-slate-500 text-sm">
        {myRoll === null
          ? "Tap to roll your die"
          : oppRoll === null
            ? `Waiting for ${opponent?.name ?? "your opponent"} to roll...`
            : ""}
      </p>
    </div>
  );
}
