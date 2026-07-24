import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { motion, AnimatePresence, useAnimationControls } from "framer-motion";
import type { PanInfo } from "framer-motion";
import { RotateCw } from "lucide-react";
import { BAR, OFF } from "../../shared/types.ts";
import type { Color, DicePair, Move } from "../../shared/types.ts";
import type { ClientMessage, StateMessage } from "../../shared/protocol.ts";
import { moveDest, other, pipCount } from "../../shared/engine/board.ts";
import { usePendingMoves } from "../hooks/usePendingMoves.ts";
import { vibrateAction } from "../lib/haptics.ts";
import {
  preloadImpatientGifs,
  randomImpatientGif,
} from "../lib/impatience.ts";
import { preloadHitGifs, reactionGif } from "../lib/hitgifs.ts";
import { Checker } from "./Checker.tsx";
import { DiceTray } from "./DiceTray.tsx";
import { PlayerHUD } from "./PlayerHUD.tsx";

// three.js is heavy; keep it out of the initial bundle and load the 3D
// dice as a separate chunk (preloaded on mount, below).
const DiceRoll3D = lazy(() => import("./DiceRoll3D.tsx"));

/**
 * The playing surface, laid out for portrait phones: the classic board
 * rotated 90°, so the 24 spikes run HORIZONTALLY in two vertical columns
 * of 12, with the bar as a horizontal strip across the middle and both
 * bear-off trays along the bottom edge.
 *
 * The board is rendered in ONE fixed orientation (white's numbering),
 * identical on both players' screens, so the two people are looking at
 * exactly the same board and can talk about the same points:
 *   left column, top→bottom: 12..7, [bar], 6..1   (white home = bottom left)
 *   right column, top→bottom: 13..18, [bar], 19..24 (black home = bottom right)
 * White moves 24→1, black moves 1→24 (opposite directions, one board).
 * The black player's drags are mapped to their own engine numbering via
 * `flip`; nothing about the shared frame reaches the server.
 *
 * Drag semantics: a checker may be dropped ONLY while over a highlighted
 * legal target (the one under the pointer is "armed" — brighter). Any
 * other release springs the checker back home. A successful drop slides
 * the checker from the release position into its exact slot.
 */

const BAR_H = 44;
const TRAY_H = 50;
const EDGE_PAD = 6;
/** Fraction of the column width the spike triangles span. */
const TRI_FRAC = 0.88;
/** How long the 3D dice roll shows (spin + a hold to read it) before it
 * fades out. The rolled values stay visible in the tray below. */
const REVEAL_MS = 2350;

interface DragState {
  from: number;
  targets: Map<number, Move[]>;
}

interface GameBoardProps {
  state: StateMessage;
  send: (msg: ClientMessage) => void;
}

export function GameBoard({ state, send }: GameBoardProps) {
  const you = state.you;
  const myColor = you.color;
  const oppColor = other(myColor);
  const opponent = state.players.find((p) => p.playerId !== you.playerId);

  const pending = usePendingMoves(state, send);
  const { displayBoard } = pending;

  // The board renders in white's numbering for everyone. If I'm black, my
  // own engine numbering is the mirror of the displayed numbering; these
  // map between the two (points 1..24 only; BAR/OFF are unchanged).
  const flip = myColor === "black";
  const toOwn = (dp: number) => (dp >= 1 && dp <= 24 ? (flip ? 25 - dp : dp) : dp);
  const toDisplay = (op: number) =>
    op >= 1 && op <= 24 ? (flip ? 25 - op : op) : op;
  /** My checkers on a displayed point (white frame). */
  const myCountAt = (A: number) =>
    myColor === "white" ? displayBoard.white[A] : displayBoard.black[25 - A];

  // Optional 180° board flip (some players like the bear-off tray at the
  // top). Purely a per-device display preference — persisted, and mapped
  // out of pointer coordinates in hitTest so interaction is unaffected.
  const [flipped, setFlipped] = useState(() => {
    try {
      return localStorage.getItem("backgammon:flipBoard") === "1";
    } catch {
      return false;
    }
  });
  const toggleFlip = () =>
    setFlipped((f) => {
      const next = !f;
      try {
        localStorage.setItem("backgammon:flipBoard", next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });

  // Warm the 3D-dice chunk while the board is idle so the first roll's
  // reveal is instant.
  useEffect(() => {
    void import("./DiceRoll3D.tsx");
  }, []);
  useEffect(() => {
    preloadHitGifs();
  }, []);

  // Points (absolute frame) where the opponent has a live, unconfirmed
  // checker this turn — glowed green so the watcher sees the move unfold.
  const previewGlow = useMemo(() => {
    const set = new Set<number>();
    const pc = pending.previewColor;
    if (!pc) return set;
    for (const m of pending.opponentPreview) {
      const dest = moveDest(m);
      if (dest === OFF) continue;
      set.add(pc === "white" ? dest : 25 - dest);
    }
    return set;
  }, [pending.opponentPreview, pending.previewColor]);

  const fieldRef = useRef<HTMLDivElement>(null);
  const [fieldSize, setFieldSize] = useState({ w: 0, h: 0 });
  const [drag, setDrag] = useState<DragState | null>(null);
  const [armedTarget, setArmedTarget] = useState<number | null>(null);

  // Refs mirror the drag state for use inside gesture handlers: a fast
  // drag can finish before React flushes the state updates.
  const dragTargetsRef = useRef<Map<number, Move[]> | null>(null);
  const armedRef = useRef<number | null>(null);
  // One staged drop per gesture (unmount teardown can re-fire onDragEnd).
  const dropHandledRef = useRef(false);
  // Slide-into-slot animation for the checker that just landed.
  const landingRef = useRef<{ p: number; dx: number; dy: number } | null>(
    null,
  );

  // The landing offset is consumed by the render that stages the move;
  // clear it right after so later renders mount checkers normally.
  useEffect(() => {
    landingRef.current = null;
  });

  useLayoutEffect(() => {
    const el = fieldRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      setFieldSize({ w: width, h: height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const { w: W, h: H } = fieldSize;
  const rowH = (H - BAR_H - TRAY_H) / 12;
  const colW = W / 2;
  const checker = Math.max(18, Math.min(rowH - 5, 44));

  // ── Dice reveal (both players see the same roll theater) ─────────

  const [reveal, setReveal] = useState<{
    dice: DicePair;
    turn: number;
    roller: Color;
  } | null>(null);
  const prevTurnRef = useRef<number | null>(null);

  useEffect(() => {
    const t = state.turnNumber;
    const prev = prevTurnRef.current;
    prevTurnRef.current = t;

    const dice = state.turn?.dice;
    if (!dice || !state.turn) return;
    // Fresh roll = turnNumber advanced while we watched (or the opening
    // roll just resolved into turn 1). Reconnects re-send the same
    // turnNumber and must NOT replay the theater.
    const fresh = prev !== null ? t > prev : t === 1;
    if (!fresh) return;

    setReveal({ dice, turn: t, roller: state.turn.color });
  }, [state.turnNumber]); // eslint-disable-line react-hooks/exhaustive-deps

  // The dock-away timer lives in its own effect keyed on the reveal
  // itself. Kept separate from the trigger above: an effect that both
  // sets state AND arms the timer behind a mutating ref guard loses its
  // timer under StrictMode's double-run, leaving the dice parked
  // center-screen forever.
  useEffect(() => {
    if (!reveal) return;
    const timer = setTimeout(() => setReveal(null), REVEAL_MS);
    return () => clearTimeout(timer);
  }, [reveal]);

  // ── Impatience nudge: 5s idle (not rolling OR not moving) → a GIF ──

  const [nudgeGif, setNudgeGif] = useState<string | null>(null);
  useEffect(() => {
    preloadImpatientGifs();
  }, []);

  // Fires whether the active player is sitting on the roll or has rolled
  // but isn't moving. The timer resets on any activity (turn change or a
  // staged move), so someone actively dragging never triggers it.
  const idlePending =
    state.phase === "playing" &&
    (state.turn?.phase === "roll" || state.turn?.phase === "move");
  useEffect(() => {
    if (!idlePending) {
      setNudgeGif(null);
      return;
    }
    const timer = setTimeout(() => setNudgeGif(randomImpatientGif()), 5000);
    return () => {
      clearTimeout(timer);
      setNudgeGif(null);
    };
  }, [idlePending, state.turnNumber, pending.staged.length]);

  // ── Hit reaction GIF: I got sent to the bar on the opponent's turn ──

  const [hitGif, setHitGif] = useState<string | null>(null);
  const seenHitTurnRef = useRef<string | null>(null);
  useEffect(() => {
    const lt = state.lastTurn;
    const key = lt ? `${state.turnNumber}:${lt.color}:${lt.hits}` : null;
    if (key && key !== seenHitTurnRef.current) {
      seenHitTurnRef.current = key;
      // The opponent just moved and it sent one or more of MY checkers to
      // the bar (lastTurn.hits counts the mover's opponent, i.e. me).
      if (lt && lt.color !== you.color && lt.hits > 0) {
        setHitGif(reactionGif(lt.hits));
      }
    }
  }, [state.lastTurn, state.turnNumber, you.color]);
  useEffect(() => {
    if (!hitGif) return;
    const timer = setTimeout(() => setHitGif(null), 2600);
    return () => clearTimeout(timer);
  }, [hitGif]);

  // ── Earthquake: any checker landing on the bar shakes the board ──

  const shakeControls = useAnimationControls();
  const prevBarsRef = useRef<{ me: number; opp: number } | null>(null);
  useEffect(() => {
    const me = displayBoard[myColor][BAR];
    const opp = displayBoard[oppColor][BAR];
    const prev = prevBarsRef.current;
    prevBarsRef.current = { me, opp };
    if (!prev || (me <= prev.me && opp <= prev.opp)) return;

    shakeControls.start({
      x: [0, -9, 8, -6, 5, -3, 0],
      y: [0, 4, -3, 3, -2, 1, 0],
      rotate: [0, -0.6, 0.5, -0.35, 0.2, -0.1, 0],
      transition: { duration: 0.55, ease: "easeOut" },
    });
  }, [displayBoard, myColor, oppColor, shakeControls]);

  // ── Geometry helpers ─────────────────────────────────────────────

  /** Top-left y of a point row (row 0..11, top→bottom, skipping the bar). */
  const rowY = (row: number) => row * rowH + (row >= 6 ? BAR_H : 0);

  const pointGeometry = (p: number) => {
    const leftCol = p <= 12;
    const row = leftCol ? 12 - p : p - 13;
    return { leftCol, row, x: leftCol ? 0 : colW, y: rowY(row) };
  };

  /** Horizontal overlap step for a stack of `count` checkers. */
  const stackStep = (count: number) =>
    count > 1
      ? Math.min(checker * 0.95, (colW * 0.86 - checker) / (count - 1))
      : 0;

  /** Field-local top-left of stack slot `index` on point `p`. */
  const slotPosition = (p: number, index: number, count: number) => {
    const { leftCol, x, y } = pointGeometry(p);
    const step = stackStep(count);
    const cx = leftCol
      ? EDGE_PAD + index * step
      : colW - EDGE_PAD - checker - index * step;
    return { x: x + cx, y: y + (rowH - checker) / 2 };
  };

  /**
   * Map a viewport coordinate to a drop target: a point, OFF, or null.
   * Deliberately strict: only the spike area of a row counts (not the
   * empty lane near the centerline), and anywhere else — bar, gaps,
   * outside the board — is a miss.
   */
  const hitTest = useCallback(
    (clientX: number, clientY: number): number | null => {
      const el = fieldRef.current;
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      // The field is CSS-rotated 180° when flipped, but its bounding box is
      // unchanged; invert the pointer into the un-rotated logical space so
      // all the row/column math below stays identical.
      const x = flipped ? W - (clientX - rect.left) : clientX - rect.left;
      const y = flipped ? H - (clientY - rect.top) : clientY - rect.top;
      if (x < 0 || x > W || y < 0 || y > H + 10) return null;

      const trayY = 12 * rowH + BAR_H;
      if (y >= trayY) {
        // Bear-off: white's tray is bottom-left, black's bottom-right.
        // Only my own tray accepts a drop.
        const leftTray = x < colW;
        return leftTray === (myColor === "white") ? OFF : null;
      }
      const barY = 6 * rowH;
      if (y >= barY && y < barY + BAR_H) return null;

      const row = y < barY ? Math.floor(y / rowH) : Math.floor((y - BAR_H) / rowH);
      if (row < 0 || row > 11) return null;

      // Require the pointer over the spike itself (plus half a checker
      // of slack), not the dead lane between the spike tips.
      const triangleLen = colW * TRI_FRAC;
      const slack = checker * 0.5;
      const overSpike =
        x < colW ? x <= triangleLen + slack : x >= W - triangleLen - slack;
      if (!overSpike) return null;

      return x < colW ? 12 - row : 13 + row;
    },
    [W, H, rowH, colW, checker, myColor, flipped],
  );

  // ── Drag handlers ────────────────────────────────────────────────

  function setArmed(value: number | null) {
    if (armedRef.current === value) return;
    armedRef.current = value;
    setArmedTarget(value);
  }

  function handleDragStart(displayFrom: number) {
    dropHandledRef.current = false;
    // targetsFor works in my own numbering; re-key the result to the
    // displayed (white-frame) numbering so hit-testing lines up.
    const ownTargets = pending.targetsFor(toOwn(displayFrom));
    const disp = new Map<number, Move[]>();
    ownTargets.forEach((path, ownDest) => {
      disp.set(ownDest === OFF ? OFF : toDisplay(ownDest), path);
    });
    dragTargetsRef.current = disp;
    armedRef.current = null;
    setArmedTarget(null);
    setDrag({ from: displayFrom, targets: disp });
  }

  function handleDragMove(info: PanInfo) {
    const targets = dragTargetsRef.current;
    if (!targets) return;
    const t = hitTest(info.point.x, info.point.y);
    setArmed(t !== null && targets.has(t) ? t : null);
  }

  function handleDragEnd(_from: number, info: PanInfo) {
    if (dropHandledRef.current) return;
    const targets = dragTargetsRef.current;
    const target = hitTest(info.point.x, info.point.y);

    if (targets && target !== null) {
      const path = targets.get(target);
      if (path) {
        dropHandledRef.current = true;

        // Slide the landed checker from the release point into its slot.
        // (Skipped when the board is flipped 180°, where the release
        // coordinates would need un-rotating — the checker still pops in.)
        const rect = fieldRef.current?.getBoundingClientRect();
        if (rect && target !== OFF && !flipped) {
          const landedCount = myCountAt(target) + 1;
          const slot = slotPosition(target, landedCount - 1, landedCount);
          landingRef.current = {
            p: target,
            dx: info.point.x - rect.left - checker / 2 - slot.x,
            dy: info.point.y - rect.top - checker / 2 - slot.y,
          };
        }

        pending.stage(path);
        vibrateAction();
      }
    }
    // No staged path: dragSnapToOrigin springs the checker home.

    dragTargetsRef.current = null;
    setArmed(null);
    setDrag(null);
  }

  // ── Derived display data ─────────────────────────────────────────

  const ready = W > 0 && H > 0;
  const noMoves = state.turn?.phase === "no_moves";
  const blockedName =
    state.turn?.color === myColor
      ? "You have"
      : `${opponent?.name ?? "They"} has`;

  const infoLine = buildInfoLine(state, pending.staged.length);
  const landing = landingRef.current;

  return (
    <div className="flex flex-1 flex-col max-w-md w-full mx-auto min-h-0 px-2 pb-1">
      <div className="flex items-center">
        <div className="flex-1 min-w-0">
          {opponent && (
            <PlayerHUD
              player={opponent}
              board={displayBoard}
              isTheirTurn={state.turn?.color === oppColor}
            />
          )}
        </div>
        <button
          type="button"
          data-testid="flip-board-btn"
          onClick={toggleFlip}
          aria-label="Flip board"
          aria-pressed={flipped}
          title="Flip board"
          className={`mr-1 p-2 rounded-lg border transition-colors cursor-pointer ${
            flipped
              ? "bg-gold/20 border-gold/50 text-gold"
              : "bg-slate-800/60 border-slate-700 text-slate-300 hover:bg-slate-700"
          }`}
        >
          <RotateCw className="w-4 h-4" />
        </button>
      </div>

      {/* Board field (shaken by hits) */}
      <motion.div
        animate={shakeControls}
        className="relative flex-1 min-h-0 rounded-xl border-[6px] border-wood bg-felt shadow-inner"
      >
        <div
          ref={fieldRef}
          className="absolute inset-0"
          style={{ transform: flipped ? "rotate(180deg)" : undefined }}
        >
          {ready && (
            <>
              {/* Point triangles + stacks (fixed white-frame numbering) */}
              {Array.from({ length: 24 }, (_, i) => i + 1).map((A) => (
                <PointRow
                  key={A}
                  p={A}
                  geometry={pointGeometry(A)}
                  colW={colW}
                  rowH={rowH}
                  checker={checker}
                  flipped={flipped}
                  whiteCount={displayBoard.white[A]}
                  blackCount={displayBoard.black[25 - A]}
                  // Draggable = I (the mover) can move from this point.
                  // Never gate on the active drag: flipping the framer
                  // `drag` prop mid-gesture kills it before onDragEnd.
                  draggable={pending.draggableSources.has(toOwn(A))}
                  dragging={drag?.from === A}
                  highlighted={drag?.targets.has(A) ?? false}
                  armed={armedTarget === A}
                  previewGlow={previewGlow.has(A)}
                  landing={landing?.p === A ? landing : null}
                  onDragStart={() => handleDragStart(A)}
                  onDrag={handleDragMove}
                  onDragEnd={(info) => handleDragEnd(A, info)}
                />
              ))}

              {/* Bar strip */}
              <BarStrip
                y={6 * rowH}
                w={W}
                checker={checker}
                myColor={myColor}
                flipped={flipped}
                whiteCount={displayBoard.white[BAR]}
                blackCount={displayBoard.black[BAR]}
                draggable={pending.draggableSources.has(BAR)}
                dragging={drag?.from === BAR}
                onDragStart={() => handleDragStart(BAR)}
                onDrag={handleDragMove}
                onDragEnd={(info) => handleDragEnd(BAR, info)}
              />

              {/* Bear-off trays: white bottom-left, black bottom-right */}
              <TrayRow
                y={12 * rowH + BAR_H}
                w={W}
                myColor={myColor}
                flipped={flipped}
                whiteOff={displayBoard.white[OFF]}
                blackOff={displayBoard.black[OFF]}
                highlighted={drag?.targets.has(OFF) ?? false}
                armed={armedTarget === OFF}
              />

              {/* Center dice reveal: 3D dice tumble across the board on
                  every roll, hold, then dock down toward the tray. Same
                  on both screens (values are server-authoritative). */}
              <AnimatePresence>
                {reveal && (
                  <motion.div
                    key={reveal.turn}
                    data-testid="dice-reveal"
                    className="absolute inset-0 z-40 pointer-events-none"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1, transition: { duration: 0.15 } }}
                    exit={{ opacity: 0, transition: { duration: 0.5 } }}
                  >
                    <Suspense fallback={null}>
                      <DiceRoll3D
                        dice={reveal.dice}
                        roller={reveal.roller}
                        myColor={myColor}
                      />
                    </Suspense>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Hit reaction: "damn" (1) / "I'm dead" (2+) when I'm sent
                  to the bar. */}
              <AnimatePresence>
                {hitGif && (
                  <motion.div
                    data-testid="hit-gif"
                    initial={{ scale: 0.5, opacity: 0, rotate: -6 }}
                    animate={{ scale: 1, opacity: 1, rotate: 0 }}
                    exit={{ scale: 0.7, opacity: 0 }}
                    transition={{ type: "spring", stiffness: 300, damping: 18 }}
                    className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 pointer-events-none flex flex-col items-center gap-2"
                  >
                    <img
                      src={hitGif}
                      alt="You got hit!"
                      className="h-36 rounded-xl shadow-2xl border-2 border-danger/70"
                    />
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Impatience nudge: someone is sitting on the dice */}
              <AnimatePresence>
                {nudgeGif && idlePending && (
                  <motion.div
                    data-testid="impatience-nudge"
                    initial={{ scale: 0.6, opacity: 0, y: 24 }}
                    animate={{ scale: 1, opacity: 1, y: 0 }}
                    exit={{ scale: 0.7, opacity: 0 }}
                    transition={{ type: "spring", stiffness: 320, damping: 22 }}
                    className="absolute left-1/2 top-[20%] -translate-x-1/2 z-40 pointer-events-none flex flex-col items-center gap-1.5"
                  >
                    <img
                      src={nudgeGif}
                      alt="Impatiently waiting"
                      className="h-28 rounded-xl shadow-2xl border-2 border-slate-900/60"
                    />
                    <span className="bg-slate-900/85 text-white text-xs font-semibold px-3 py-1 rounded-full whitespace-nowrap">
                      {state.turn?.color === myColor
                        ? `${opponent?.name ?? "Your opponent"} is waiting...`
                        : "Any day now..."}
                    </span>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* No-legal-moves banner */}
              <AnimatePresence>
                {noMoves && (
                  <motion.div
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ delay: reveal ? 1 : 0 }}
                    data-testid="dance-banner"
                    className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-slate-900/90 border border-gold/50 text-white px-5 py-3 rounded-2xl text-center shadow-2xl z-30"
                  >
                    <div className="font-bold text-gold">
                      {blockedName} no legal moves
                    </div>
                    <div className="text-xs text-slate-400 mt-0.5">
                      The turn passes automatically
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </>
          )}
        </div>
      </motion.div>

      {/* Info strip: my pips + contextual hint */}
      <div className="flex items-center justify-between px-2 pt-1.5 text-xs text-slate-400 h-6">
        <span className="tabular-nums" data-testid="my-pips">
          You · {pipCount(displayBoard, myColor)} pips
          {displayBoard[myColor][OFF] > 0
            ? ` · ${displayBoard[myColor][OFF]} off`
            : ""}
        </span>
        <span
          className="truncate max-w-[60%] text-right"
          data-testid="info-line"
        >
          {infoLine}
        </span>
      </div>

      <DiceTray
        state={state}
        send={send}
        staged={pending.staged}
        canConfirm={pending.canConfirm}
        remaining={pending.remaining}
        onUndo={pending.undo}
        onConfirm={pending.confirm}
      />
    </div>
  );
}

/** One-line contextual hint above the dice tray. */
function buildInfoLine(state: StateMessage, stagedCount: number): string {
  const turn = state.turn;
  const you = state.you;
  if (!turn) return "";

  const myTurn = turn.color === you.color;

  if (myTurn && turn.phase === "move") {
    if (state.turnNumber === 1) return "You won the opening roll!";
    if (turn.forcedDie !== null && stagedCount === 0) {
      return `You must play the ${turn.forcedDie}`;
    }
    if (turn.dice && turn.dice[0] !== turn.dice[1] && turn.maxPlayable === 1) {
      return "Only one die can be played";
    }
    if (turn.maxPlayable > 0 && turn.maxPlayable < 4 && turn.dice && turn.dice[0] === turn.dice[1]) {
      return `Doubles! ${turn.maxPlayable} moves playable`;
    }
    return "Drag a glowing checker";
  }

  // Otherwise recap the previous turn.
  const lt = state.lastTurn;
  if (!lt) {
    if (!myTurn && state.turnNumber === 1) {
      const mover = state.players.find((p) => p.color === turn.color);
      return `${mover?.name ?? "Opponent"} won the opening roll`;
    }
    return "";
  }
  const mover = state.players.find((p) => p.color === lt.color);
  const name = mover?.playerId === you.playerId ? "You" : (mover?.name ?? lt.color);
  const dice = `${lt.dice[0]}-${lt.dice[1]}`;
  if (lt.moves.length === 0) return `${name} rolled ${dice}: no moves`;
  const played = lt.moves
    .map((m) => {
      const dest = moveDest(m);
      return `${m.from === BAR ? "bar" : m.from}/${dest === OFF ? "off" : dest}`;
    })
    .join(" ");
  return `${name}: ${dice} · ${played}`;
}

// ── Point row ───────────────────────────────────────────────────────

interface PointRowProps {
  p: number;
  geometry: { leftCol: boolean; row: number; x: number; y: number };
  colW: number;
  rowH: number;
  checker: number;
  flipped: boolean;
  /** Absolute (white-frame) occupancy — same for both viewers. */
  whiteCount: number;
  blackCount: number;
  /** True when I (the mover) can pick up the top checker here. */
  draggable: boolean;
  dragging: boolean;
  highlighted: boolean;
  /** The pointer is currently over this point mid-drag: drop will land here. */
  armed: boolean;
  /** The opponent has a live, unconfirmed checker here (green glow). */
  previewGlow: boolean;
  /** Entry offset for a checker that just landed here (slide-in). */
  landing: { dx: number; dy: number } | null;
  onDragStart: () => void;
  onDrag: (info: PanInfo) => void;
  onDragEnd: (info: PanInfo) => void;
}

function PointRow({
  p,
  geometry,
  colW,
  rowH,
  checker,
  flipped,
  whiteCount,
  blackCount,
  draggable,
  dragging,
  highlighted,
  armed,
  previewGlow,
  landing,
  onDragStart,
  onDrag,
  onDragEnd,
}: PointRowProps) {
  const { leftCol, x, y } = geometry;
  const count = whiteCount > 0 ? whiteCount : blackCount;
  const color: Color = whiteCount > 0 ? "white" : "black";
  const dark = p % 2 === 0;

  const triangleLen = colW * TRI_FRAC;
  const step =
    count > 1
      ? Math.min(checker * 0.95, (colW * 0.86 - checker) / (count - 1))
      : 0;

  const checkerX = (i: number) =>
    leftCol ? EDGE_PAD + i * step : colW - EDGE_PAD - checker - i * step;
  const checkerY = (rowH - checker) / 2;

  return (
    <div
      data-testid={`point-${p}`}
      data-count={count}
      data-color={count > 0 ? color : ""}
      className="absolute"
      style={{
        left: x,
        top: y,
        width: colW,
        height: rowH,
        zIndex: dragging ? 40 : undefined,
      }}
    >
      {/* Spike triangle */}
      <div
        className={`absolute top-[2px] bottom-[2px] ${
          dark ? "bg-point-dark" : "bg-point-light"
        } ${highlighted ? "opacity-100" : "opacity-80"}`}
        style={{
          left: leftCol ? 0 : colW - triangleLen,
          width: triangleLen,
          clipPath: leftCol
            ? "polygon(0 0, 0 100%, 100% 50%)"
            : "polygon(100% 0, 100% 100%, 0 50%)",
        }}
      />

      {/* Point number (helps orientation). Counter-rotated when the board
          is flipped so it stays readable. */}
      <span
        className="absolute text-[9px] text-white/35 font-medium select-none"
        style={{
          top: 1,
          [leftCol ? "left" : "right"]: 3,
          transform: flipped ? "rotate(180deg)" : undefined,
        }}
      >
        {p}
      </span>

      {/* Drop-target highlight: subtle pulse for legal targets, solid
          "locked on" treatment for the one under the pointer. */}
      {highlighted && !armed && (
        <motion.div
          data-testid={`target-${p}`}
          animate={{ opacity: [0.45, 0.85, 0.45] }}
          transition={{ repeat: Infinity, duration: 1.1 }}
          className="absolute inset-[1px] rounded-md border-2 border-gold/70 bg-gold/10 pointer-events-none z-10"
        />
      )}
      {armed && (
        <div
          data-testid={`armed-${p}`}
          className="absolute inset-[1px] rounded-md border-[3px] border-gold bg-gold/25 pointer-events-none z-10 shadow-[0_0_14px_rgba(245,158,11,0.5)]"
        />
      )}

      {/* Opponent's in-progress (unconfirmed) move lands here — green glow */}
      {previewGlow && (
        <motion.div
          data-testid={`preview-${p}`}
          animate={{ opacity: [0.5, 0.95, 0.5] }}
          transition={{ repeat: Infinity, duration: 1 }}
          className="absolute inset-[1px] rounded-md border-2 border-emerald-400 bg-emerald-400/20 pointer-events-none z-10 shadow-[0_0_14px_rgba(52,211,153,0.6)]"
        />
      )}

      {/* Checkers */}
      {Array.from({ length: count }).map((_, i) => {
        const isTop = i === count - 1;
        return (
          <Checker
            key={`${p}-${i}`}
            color={color}
            size={checker}
            x={checkerX(i)}
            y={checkerY}
            draggable={draggable && isTop}
            onDragStart={onDragStart}
            onDrag={onDrag}
            onDragEnd={onDragEnd}
            enterFrom={isTop ? landing : null}
            testid={isTop ? `top-${p}` : undefined}
          />
        );
      })}

      {/* Tall-stack count badge */}
      {count > 5 && (
        <span
          className="absolute text-[10px] font-bold text-white bg-slate-900/80 rounded-full px-1.5 py-0.5 pointer-events-none z-20"
          style={{
            top: checkerY + checker / 2 - 9,
            [leftCol ? "left" : "right"]:
              EDGE_PAD + (count - 1) * step + checker / 2 - 8,
          }}
        >
          {count}
        </span>
      )}
    </div>
  );
}

// ── Bar strip ───────────────────────────────────────────────────────

interface BarStripProps {
  y: number;
  w: number;
  checker: number;
  myColor: Color;
  flipped: boolean;
  /** Absolute occupancy of the bar — same for both viewers. */
  whiteCount: number;
  blackCount: number;
  draggable: boolean;
  dragging: boolean;
  onDragStart: () => void;
  onDrag: (info: PanInfo) => void;
  onDragEnd: (info: PanInfo) => void;
}

function BarStrip({
  y,
  w,
  checker,
  myColor,
  flipped,
  whiteCount,
  blackCount,
  draggable,
  dragging,
  onDragStart,
  onDrag,
  onDragEnd,
}: BarStripProps) {
  const cy = (BAR_H - checker) / 2;
  const step = checker * 0.45;

  // White clusters left of centre, black right — fixed for both players.
  const clusters: { color: Color; count: number; baseX: number; dir: number }[] =
    [
      { color: "white", count: whiteCount, baseX: w * 0.3, dir: 1 },
      { color: "black", count: blackCount, baseX: w * 0.7, dir: -1 },
    ];

  return (
    <div
      data-testid="bar"
      data-count-you={myColor === "white" ? whiteCount : blackCount}
      data-count-opponent={myColor === "white" ? blackCount : whiteCount}
      className="absolute bg-wood border-y border-wood-light/40"
      style={{
        left: 0,
        top: y,
        width: w,
        height: BAR_H,
        zIndex: dragging ? 40 : 5,
      }}
    >
      <span
        className="absolute inset-0 flex items-center justify-center text-[10px] font-semibold tracking-[0.3em] text-white/25 select-none"
        style={{ transform: flipped ? "rotate(180deg)" : undefined }}
      >
        BAR
      </span>

      {clusters.map(({ color, count, baseX, dir }) =>
        Array.from({ length: count }).map((_, i) => {
          const isTop = i === count - 1;
          const mine = color === myColor;
          return (
            <Checker
              key={`bar-${color}-${i}`}
              color={color}
              size={checker}
              x={baseX - checker / 2 + dir * i * step}
              y={cy}
              draggable={mine && draggable && isTop}
              onDragStart={mine ? onDragStart : undefined}
              onDrag={mine ? onDrag : undefined}
              onDragEnd={mine ? onDragEnd : undefined}
              testid={mine && isTop ? "top-25" : undefined}
            />
          );
        }),
      )}
    </div>
  );
}

// ── Bear-off trays ──────────────────────────────────────────────────

interface TrayRowProps {
  y: number;
  w: number;
  myColor: Color;
  flipped: boolean;
  /** Absolute borne-off counts — white's tray is left, black's is right. */
  whiteOff: number;
  blackOff: number;
  highlighted: boolean;
  armed: boolean;
}

function TrayRow({
  y,
  w,
  myColor,
  flipped,
  whiteOff,
  blackOff,
  highlighted,
  armed,
}: TrayRowProps) {
  const labelStyle = flipped ? { transform: "rotate(180deg)" } : undefined;

  const tray = (side: "left" | "right", color: Color, off: number) => {
    const mine = color === myColor;
    return (
      <div
        data-testid={mine ? "tray-you" : "tray-opponent"}
        data-count={off}
        className={`relative flex-1 m-1 rounded-lg border-2 flex items-center px-2 gap-1 transition-colors ${
          side === "right" ? "justify-end" : ""
        } ${
          mine && armed
            ? "border-gold bg-gold/30 shadow-[0_0_14px_rgba(245,158,11,0.5)]"
            : mine && highlighted
              ? "border-gold bg-gold/15"
              : "border-wood-light/50 bg-wood-dark/70"
        }`}
      >
        {side === "left" && <TrayChips count={off} color={color} />}
        <span
          className={`text-[10px] font-semibold text-white/50 select-none ${
            side === "left" ? "ml-auto" : "mr-auto"
          }`}
          style={labelStyle}
        >
          {off > 0 ? `${off} OFF` : mine ? "BEAR OFF" : ""}
        </span>
        {side === "right" && <TrayChips count={off} color={color} mirrored />}
        {mine && highlighted && !armed && (
          <motion.div
            data-testid="target-off"
            animate={{ opacity: [0.4, 0.9, 0.4] }}
            transition={{ repeat: Infinity, duration: 1.1 }}
            className="absolute inset-0 rounded-lg border-2 border-gold pointer-events-none"
          />
        )}
      </div>
    );
  };

  return (
    <div
      className="absolute flex"
      style={{ left: 0, top: y, width: w, height: TRAY_H }}
    >
      {tray("left", "white", whiteOff)}
      {tray("right", "black", blackOff)}
    </div>
  );
}

function TrayChips({
  count,
  color,
  mirrored = false,
}: {
  count: number;
  color: Color;
  mirrored?: boolean;
}) {
  return (
    <div className={`flex gap-[3px] ${mirrored ? "flex-row-reverse" : ""}`}>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className={`w-[7px] rounded-sm ${
            color === "white"
              ? "bg-ivory border border-ivory-edge"
              : "bg-onyx border border-onyx-edge"
          }`}
          style={{ height: TRAY_H - 22 }}
        />
      ))}
    </div>
  );
}
