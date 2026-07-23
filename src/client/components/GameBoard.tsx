import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { PanInfo } from "framer-motion";
import { BAR, OFF } from "../../shared/types.ts";
import type { Color, Move } from "../../shared/types.ts";
import type { ClientMessage, StateMessage } from "../../shared/protocol.ts";
import { moveDest, other, pipCount } from "../../shared/engine/board.ts";
import { usePendingMoves } from "../hooks/usePendingMoves.ts";
import { vibrateAction } from "../lib/haptics.ts";
import { Checker } from "./Checker.tsx";
import { DiceTray } from "./DiceTray.tsx";
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
 * You race up the right side, across the top, and down the left into
 * your home board; your bear-off tray sits under it at bottom-left.
 */

const BAR_H = 44;
const TRAY_H = 50;
const EDGE_PAD = 6;

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

  // ── Geometry helpers ─────────────────────────────────────────────

  /** Top-left y of a point row (row 0..11, top→bottom, skipping the bar). */
  const rowY = (row: number) => row * rowH + (row >= 6 ? BAR_H : 0);

  const pointGeometry = (p: number) => {
    const leftCol = p <= 12;
    const row = leftCol ? 12 - p : p - 13;
    return { leftCol, row, x: leftCol ? 0 : colW, y: rowY(row) };
  };

  /** Map a viewport coordinate to a drop target: point, OFF, or null. */
  const hitTest = useCallback(
    (clientX: number, clientY: number): number | null => {
      const el = fieldRef.current;
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      const x = clientX - rect.left;
      const y = clientY - rect.top;
      if (x < 0 || x > W || y < 0 || y > H + 24) return null;

      const trayY = 12 * rowH + BAR_H;
      if (y >= trayY) {
        // Only MY tray (left half, under my home board) accepts drops.
        return x < colW ? OFF : null;
      }
      const barY = 6 * rowH;
      if (y >= barY && y < barY + BAR_H) return null;

      const row = y < barY ? Math.floor(y / rowH) : Math.floor((y - BAR_H) / rowH);
      if (row < 0 || row > 11) return null;
      return x < colW ? 12 - row : 13 + row;
    },
    [W, H, rowH, colW],
  );

  // ── Drag handlers ────────────────────────────────────────────────

  // Staging a drop re-renders the stack and unmounts the dragged checker,
  // which can make framer fire a second onDragEnd during teardown. One
  // drop per gesture, enforced with a ref (state is too slow for fast
  // automated drags).
  const dropHandledRef = useRef(false);

  function handleDragStart(from: number) {
    dropHandledRef.current = false;
    setDrag({ from, targets: pending.targetsFor(from) });
  }

  function handleDragEnd(from: number, info: PanInfo) {
    if (dropHandledRef.current) return;
    // Recompute targets here instead of reading the `drag` state: a fast
    // drag (automation, quick flicks) can finish before React flushes the
    // onDragStart state update, which would make the drop a silent no-op.
    const target = hitTest(info.point.x, info.point.y);
    if (target !== null) {
      const path = pending.targetsFor(from).get(target);
      if (path) {
        dropHandledRef.current = true;
        pending.stage(path);
        vibrateAction();
      }
    }
    setDrag(null);
  }

  /** Tap = play the best single hop from this point (largest die). */
  function handleTap(from: number) {
    const targets = pending.targetsFor(from);
    let best: Move[] | null = null;
    for (const path of targets.values()) {
      if (path.length !== 1) continue;
      if (!best || path[0].die > best[0].die) best = path;
    }
    if (best) {
      pending.stage(best);
      vibrateAction();
    }
  }

  // ── Derived display data ─────────────────────────────────────────

  const ready = W > 0 && H > 0;
  const noMoves = state.turn?.phase === "no_moves";
  const blockedName =
    state.turn?.color === myColor ? "You have" : `${opponent?.name ?? "They"} has`;

  const infoLine = buildInfoLine(state, pending.staged.length);

  return (
    <div className="flex flex-1 flex-col max-w-md w-full mx-auto min-h-0 px-2 pb-1">
      {opponent && (
        <PlayerHUD
          player={opponent}
          board={displayBoard}
          isTheirTurn={state.turn?.color === oppColor}
        />
      )}

      {/* Board field */}
      <div className="relative flex-1 min-h-0 rounded-xl border-[6px] border-wood bg-felt shadow-inner">
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
                  onDragStart={() => handleDragStart(p)}
                  onDragEnd={(info) => handleDragEnd(p, info)}
                  onTap={() => handleTap(p)}
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
                onDragEnd={(info) => handleDragEnd(BAR, info)}
                onTap={() => handleTap(BAR)}
              />

              {/* Bear-off trays */}
              <TrayRow
                y={12 * rowH + BAR_H}
                w={W}
                myColor={myColor}
                myOff={displayBoard[myColor][OFF]}
                oppOff={displayBoard[oppColor][OFF]}
                highlighted={drag?.targets.has(OFF) ?? false}
              />

              {/* No-legal-moves banner */}
              <AnimatePresence>
                {noMoves && (
                  <motion.div
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ opacity: 0 }}
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
      </div>

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
  onDragStart: () => void;
  onDragEnd: (info: PanInfo) => void;
  onTap: () => void;
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
  onDragStart,
  onDragEnd,
  onTap,
}: PointRowProps) {
  const { leftCol, x, y } = geometry;
  const count = myCount > 0 ? myCount : oppCount;
  const color: Color = myCount > 0 ? myColor : other(myColor);
  const dark = p % 2 === 0;

  const triangleLen = colW * 0.88;
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

      {/* Drop-target highlight */}
      {highlighted && (
        <motion.div
          data-testid={`target-${p}`}
          animate={{ opacity: [0.5, 0.9, 0.5] }}
          transition={{ repeat: Infinity, duration: 1.1 }}
          className="absolute inset-[1px] rounded-md border-2 border-gold bg-gold/15 pointer-events-none z-10"
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
            onDragEnd={onDragEnd}
            onTap={onTap}
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
  onDragEnd: (info: PanInfo) => void;
  onTap: () => void;
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
  onDragEnd,
  onTap,
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
          onDragEnd={onDragEnd}
          onTap={onTap}
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
}

function TrayRow({ y, w, myColor, myOff, oppOff, highlighted }: TrayRowProps) {
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
          highlighted
            ? "border-gold bg-gold/20"
            : "border-wood-light/50 bg-wood-dark/70"
        }`}
      >
        <TrayChips count={myOff} color={myColor} />
        <span className="ml-auto text-[10px] font-semibold text-white/50 select-none">
          {myOff > 0 ? `${myOff} OFF` : "BEAR OFF"}
        </span>
        {highlighted && (
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
