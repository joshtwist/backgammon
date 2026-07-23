import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { motion, AnimatePresence, useAnimationControls } from "framer-motion";
import type { PanInfo } from "framer-motion";
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
import { Checker } from "./Checker.tsx";
import { DiceTray } from "./DiceTray.tsx";
import { DieFace } from "./Dice.tsx";
import { PlayerHUD } from "./PlayerHUD.tsx";

/**
 * The playing surface, laid out for portrait phones: the classic board
 * rotated 90°, so the 24 spikes run HORIZONTALLY in two vertical columns
 * of 12, with the bar as a horizontal strip across the middle and both
 * bear-off trays along the bottom edge.
 *
 * Everything renders from the viewing player's own perspective:
 *   left column, top→bottom: 12..7, [bar], 6..1   (home = bottom left)
 *   right column, top→bottom: 13..18, [bar], 19..24 (opp home = bottom right)
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
/** How long the center dice reveal holds before docking to the tray. */
const REVEAL_MS = 1350;

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

  // ── Impatience nudge: 5s of not rolling → a judgmental GIF ───────

  const [nudgeGif, setNudgeGif] = useState<string | null>(null);
  useEffect(() => {
    preloadImpatientGifs();
  }, []);

  const rollPending =
    state.phase === "playing" && state.turn?.phase === "roll";
  useEffect(() => {
    if (!rollPending) {
      setNudgeGif(null);
      return;
    }
    const timer = setTimeout(() => setNudgeGif(randomImpatientGif()), 5000);
    return () => {
      clearTimeout(timer);
      setNudgeGif(null);
    };
  }, [rollPending, state.turnNumber]);

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
      const x = clientX - rect.left;
      const y = clientY - rect.top;
      if (x < 0 || x > W || y < 0 || y > H + 10) return null;

      const trayY = 12 * rowH + BAR_H;
      if (y >= trayY) {
        // Only MY tray (left half, under my home board) accepts drops.
        return x < colW ? OFF : null;
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
    [W, H, rowH, colW, checker],
  );

  // ── Drag handlers ────────────────────────────────────────────────

  function setArmed(value: number | null) {
    if (armedRef.current === value) return;
    armedRef.current = value;
    setArmedTarget(value);
  }

  function handleDragStart(from: number) {
    dropHandledRef.current = false;
    dragTargetsRef.current = pending.targetsFor(from);
    armedRef.current = null;
    setArmedTarget(null);
    setDrag({ from, targets: dragTargetsRef.current });
  }

  function handleDragMove(info: PanInfo) {
    const targets = dragTargetsRef.current;
    if (!targets) return;
    const t = hitTest(info.point.x, info.point.y);
    setArmed(t !== null && targets.has(t) ? t : null);
  }

  function handleDragEnd(from: number, info: PanInfo) {
    if (dropHandledRef.current) return;
    const targets = dragTargetsRef.current ?? pending.targetsFor(from);
    const target = hitTest(info.point.x, info.point.y);

    if (target !== null) {
      const path = targets.get(target);
      if (path) {
        dropHandledRef.current = true;

        // Slide the landed checker from the release point into its slot.
        const rect = fieldRef.current?.getBoundingClientRect();
        if (rect && target !== OFF) {
          const landedCount = displayBoard[myColor][target] + 1;
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
      {opponent && (
        <PlayerHUD
          player={opponent}
          board={displayBoard}
          isTheirTurn={state.turn?.color === oppColor}
        />
      )}

      {/* Board field (shaken by hits) */}
      <motion.div
        animate={shakeControls}
        className="relative flex-1 min-h-0 rounded-xl border-[6px] border-wood bg-felt shadow-inner"
      >
        <div ref={fieldRef} className="absolute inset-0">
          {ready && (
            <>
              {/* Point triangles + stacks */}
              {Array.from({ length: 24 }, (_, i) => i + 1).map((p) => (
                <PointRow
                  key={p}
                  p={p}
                  geometry={pointGeometry(p)}
                  colW={colW}
                  rowH={rowH}
                  checker={checker}
                  myColor={myColor}
                  myCount={displayBoard[myColor][p]}
                  oppCount={displayBoard[oppColor][25 - p]}
                  // Never gate this on the active drag: flipping the
                  // framer `drag` prop to false mid-gesture kills the
                  // gesture before onDragEnd can fire.
                  draggable={pending.draggableSources.has(p)}
                  dragging={drag?.from === p}
                  highlighted={drag?.targets.has(p) ?? false}
                  armed={armedTarget === p}
                  landing={landing?.p === p ? landing : null}
                  onDragStart={() => handleDragStart(p)}
                  onDrag={handleDragMove}
                  onDragEnd={(info) => handleDragEnd(p, info)}
                />
              ))}

              {/* Bar strip */}
              <BarStrip
                y={6 * rowH}
                w={W}
                checker={checker}
                myColor={myColor}
                myCount={displayBoard[myColor][BAR]}
                oppCount={displayBoard[oppColor][BAR]}
                draggable={pending.draggableSources.has(BAR)}
                dragging={drag?.from === BAR}
                onDragStart={() => handleDragStart(BAR)}
                onDrag={handleDragMove}
                onDragEnd={(info) => handleDragEnd(BAR, info)}
              />

              {/* Bear-off trays */}
              <TrayRow
                y={12 * rowH + BAR_H}
                w={W}
                myColor={myColor}
                myOff={displayBoard[myColor][OFF]}
                oppOff={displayBoard[oppColor][OFF]}
                highlighted={drag?.targets.has(OFF) ?? false}
                armed={armedTarget === OFF}
              />

              {/* Center dice reveal: flies in on every roll, holds, then
                  docks down toward the tray. Same on both screens. */}
              <AnimatePresence>
                {reveal && (
                  <motion.div
                    key={reveal.turn}
                    data-testid="dice-reveal"
                    className="absolute inset-0 z-40 flex items-center justify-center gap-5 pointer-events-none"
                    exit={{
                      y: H * 0.42,
                      scale: 0.45,
                      opacity: 0,
                      transition: { duration: 0.45, ease: [0.5, 0, 0.75, 1] },
                    }}
                  >
                    {reveal.dice.map((d, i) => (
                      <motion.div
                        key={i}
                        initial={{
                          y: reveal.roller === myColor ? 140 : -140,
                          x: i === 0 ? -30 : 30,
                          rotate: i === 0 ? -220 : 200,
                          scale: 0.3,
                          opacity: 0,
                        }}
                        animate={{ y: 0, x: 0, rotate: 0, scale: 1.55, opacity: 1 }}
                        transition={{
                          type: "spring",
                          stiffness: 240,
                          damping: 15,
                          delay: i * 0.09,
                        }}
                        style={{ filter: "drop-shadow(0 6px 14px rgba(0,0,0,0.5))" }}
                      >
                        <DieFace value={d} size="lg" />
                      </motion.div>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Impatience nudge: someone is sitting on the dice */}
              <AnimatePresence>
                {nudgeGif && rollPending && (
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
  myColor: Color;
  myCount: number;
  oppCount: number;
  draggable: boolean;
  dragging: boolean;
  highlighted: boolean;
  /** The pointer is currently over this point mid-drag: drop will land here. */
  armed: boolean;
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
  myColor,
  myCount,
  oppCount,
  draggable,
  dragging,
  highlighted,
  armed,
  landing,
  onDragStart,
  onDrag,
  onDragEnd,
}: PointRowProps) {
  const { leftCol, x, y } = geometry;
  const count = myCount > 0 ? myCount : oppCount;
  const color: Color = myCount > 0 ? myColor : other(myColor);
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

      {/* Point number (helps orientation) */}
      <span
        className="absolute text-[9px] text-white/35 font-medium select-none"
        style={{
          top: 1,
          [leftCol ? "left" : "right"]: 3,
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

      {/* Checkers */}
      {Array.from({ length: count }).map((_, i) => {
        const isTop = i === count - 1;
        const mine = myCount > 0;
        return (
          <Checker
            key={`${p}-${i}`}
            color={color}
            size={checker}
            x={checkerX(i)}
            y={checkerY}
            draggable={mine && draggable && isTop}
            onDragStart={onDragStart}
            onDrag={onDrag}
            onDragEnd={onDragEnd}
            enterFrom={isTop && mine ? landing : null}
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
  myCount: number;
  oppCount: number;
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
  myCount,
  oppCount,
  draggable,
  dragging,
  onDragStart,
  onDrag,
  onDragEnd,
}: BarStripProps) {
  const cy = (BAR_H - checker) / 2;
  const step = checker * 0.45;

  return (
    <div
      data-testid="bar"
      data-count-you={myCount}
      data-count-opponent={oppCount}
      className="absolute bg-wood border-y border-wood-light/40"
      style={{
        left: 0,
        top: y,
        width: w,
        height: BAR_H,
        zIndex: dragging ? 40 : 5,
      }}
    >
      <span className="absolute inset-0 flex items-center justify-center text-[10px] font-semibold tracking-[0.3em] text-white/25 select-none">
        BAR
      </span>

      {/* My hit checkers cluster left of center */}
      {Array.from({ length: myCount }).map((_, i) => (
        <Checker
          key={`bar-you-${i}`}
          color={myColor}
          size={checker}
          x={w * 0.3 - checker / 2 + i * step}
          y={cy}
          draggable={draggable && i === myCount - 1}
          onDragStart={onDragStart}
          onDrag={onDrag}
          onDragEnd={onDragEnd}
          testid={i === myCount - 1 ? "top-25" : undefined}
        />
      ))}

      {/* Opponent's hit checkers cluster right of center */}
      {Array.from({ length: oppCount }).map((_, i) => (
        <Checker
          key={`bar-opp-${i}`}
          color={other(myColor)}
          size={checker}
          x={w * 0.7 - checker / 2 - i * step}
          y={cy}
        />
      ))}
    </div>
  );
}

// ── Bear-off trays ──────────────────────────────────────────────────

interface TrayRowProps {
  y: number;
  w: number;
  myColor: Color;
  myOff: number;
  oppOff: number;
  highlighted: boolean;
  armed: boolean;
}

function TrayRow({
  y,
  w,
  myColor,
  myOff,
  oppOff,
  highlighted,
  armed,
}: TrayRowProps) {
  return (
    <div
      className="absolute flex"
      style={{ left: 0, top: y, width: w, height: TRAY_H }}
    >
      {/* My tray (bottom-left, under my home board) */}
      <div
        data-testid="tray-you"
        data-count={myOff}
        className={`relative flex-1 m-1 rounded-lg border-2 flex items-center px-2 gap-1 transition-colors ${
          armed
            ? "border-gold bg-gold/30 shadow-[0_0_14px_rgba(245,158,11,0.5)]"
            : highlighted
              ? "border-gold bg-gold/15"
              : "border-wood-light/50 bg-wood-dark/70"
        }`}
      >
        <TrayChips count={myOff} color={myColor} />
        <span className="ml-auto text-[10px] font-semibold text-white/50 select-none">
          {myOff > 0 ? `${myOff} OFF` : "BEAR OFF"}
        </span>
        {highlighted && !armed && (
          <motion.div
            data-testid="target-off"
            animate={{ opacity: [0.4, 0.9, 0.4] }}
            transition={{ repeat: Infinity, duration: 1.1 }}
            className="absolute inset-0 rounded-lg border-2 border-gold pointer-events-none"
          />
        )}
      </div>

      {/* Opponent tray (bottom-right, under their home board) */}
      <div
        data-testid="tray-opponent"
        data-count={oppOff}
        className="relative flex-1 m-1 rounded-lg border-2 border-wood-light/50 bg-wood-dark/70 flex items-center justify-end px-2 gap-1"
      >
        <span className="mr-auto text-[10px] font-semibold text-white/50 select-none">
          {oppOff > 0 ? `${oppOff} OFF` : ""}
        </span>
        <TrayChips count={oppOff} color={other(myColor)} mirrored />
      </div>
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
