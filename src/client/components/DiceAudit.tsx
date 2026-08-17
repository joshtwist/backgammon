import { motion } from "framer-motion";
import { X } from "lucide-react";
import type { StateMessage } from "../../shared/protocol.ts";
import type { Color, DiceTally } from "../../shared/types.ts";

/**
 * Dice audit: every die actually rolled in this game (and across the
 * series), tallied per player.
 *
 * It exists because "the computer is luckier than me" is unfalsifiable
 * without receipts. Both sides draw from one generator that takes no
 * player argument, so these columns should converge on ~16.7% per face
 * and ~16.7% doubles. Small samples look lumpy — that's what randomness
 * does, and the sample size is shown so a lumpy 30 rolls isn't mistaken
 * for evidence.
 */

interface DiceAuditProps {
  state: StateMessage;
  onClose: () => void;
}

const FACES = [1, 2, 3, 4, 5, 6];

/** Below this many dice, a chi-square figure is noise, not information. */
const MIN_SAMPLE = 30;

function total(t: DiceTally): number {
  return FACES.reduce((sum, f) => sum + t.faces[f], 0);
}

function mean(t: DiceTally): number {
  const n = total(t);
  if (n === 0) return 0;
  return FACES.reduce((sum, f) => sum + f * t.faces[f], 0) / n;
}

/**
 * Chi-square goodness-of-fit against a uniform die (5 degrees of
 * freedom). Below 11.07 is "consistent with fair" at p=0.05.
 */
function chiSquare(t: DiceTally): number {
  const n = total(t);
  if (n === 0) return 0;
  const expected = n / 6;
  return FACES.reduce(
    (sum, f) => sum + (t.faces[f] - expected) ** 2 / expected,
    0,
  );
}

export function DiceAudit({ state, onClose }: DiceAuditProps) {
  const me = state.players.find((p) => p.playerId === state.you.playerId);
  const them = state.players.find((p) => p.playerId !== state.you.playerId);

  const column = (color: Color | undefined, label: string) => {
    const t = color ? state.diceStats[color] : null;
    return { label, tally: t };
  };

  const columns = [
    column(me?.color, "You"),
    column(them?.color, them?.name ?? "Them"),
  ];

  const maxCount = Math.max(
    1,
    ...columns.flatMap((c) =>
      c.tally ? FACES.map((f) => c.tally!.faces[f]) : [0],
    ),
  );

  return (
    <motion.div
      data-testid="dice-audit"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.92, y: 12 }}
        animate={{ scale: 1, y: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md max-h-full overflow-y-auto p-5"
      >
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-lg font-bold">Dice audit</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            data-testid="dice-audit-close"
            className="p-1 text-slate-400 hover:text-white cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <p className="text-xs text-slate-400 mb-4">
          Every die rolled so far, counted per player. Both sides use the
          same generator, so these should even out toward 16.7% each.
        </p>

        <div className="grid grid-cols-2 gap-4">
          {columns.map(({ label, tally }) => (
            <div key={label}>
              <div className="font-semibold text-sm mb-2 truncate">{label}</div>
              {!tally || total(tally) === 0 ? (
                <div className="text-slate-500 text-xs">No rolls yet</div>
              ) : (
                <>
                  <div className="space-y-1">
                    {FACES.map((f) => {
                      const count = tally.faces[f];
                      const pct = (count / total(tally)) * 100;
                      return (
                        <div key={f} className="flex items-center gap-1.5">
                          <span className="text-xs text-slate-400 w-3 tabular-nums">
                            {f}
                          </span>
                          <div className="flex-1 h-3 bg-slate-800 rounded-sm overflow-hidden">
                            <div
                              className="h-full bg-gold/70"
                              style={{ width: `${(count / maxCount) * 100}%` }}
                            />
                          </div>
                          <span className="text-[10px] text-slate-400 tabular-nums w-9 text-right">
                            {pct.toFixed(0)}%
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  <dl className="mt-3 text-[11px] text-slate-400 space-y-0.5 tabular-nums">
                    <div className="flex justify-between">
                      <dt>Dice</dt>
                      <dd>{total(tally)}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt>Average</dt>
                      <dd>{mean(tally).toFixed(2)}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt>Doubles</dt>
                      <dd>
                        {tally.doubles}
                        {tally.rolls > 0
                          ? ` (${((tally.doubles / tally.rolls) * 100).toFixed(0)}%)`
                          : ""}
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt title="Below 11.07 is consistent with a fair die">
                        χ²
                      </dt>
                      {/* Meaningless on a handful of dice — showing a
                          number there invites reading noise as proof. */}
                      <dd>
                        {total(tally) >= MIN_SAMPLE
                          ? chiSquare(tally).toFixed(1)
                          : `needs ${MIN_SAMPLE}+`}
                      </dd>
                    </div>
                  </dl>
                </>
              )}
            </div>
          ))}
        </div>

        <p className="text-[11px] text-slate-500 mt-4 leading-relaxed">
          A fair die averages <span className="tabular-nums">3.50</span> and
          rolls doubles <span className="tabular-nums">16.7%</span> of the
          time. χ² under <span className="tabular-nums">11.07</span> means the
          spread is consistent with fair. Expect noise under a few hundred
          dice — short streaks are normal, not evidence.
        </p>
      </motion.div>
    </motion.div>
  );
}
