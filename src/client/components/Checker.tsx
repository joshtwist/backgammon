import { motion } from "framer-motion";
import type { PanInfo } from "framer-motion";
import type { Color } from "../../shared/types.ts";

interface CheckerProps {
  color: Color;
  size: number;
  x: number;
  y: number;
  /** Only the top checker of a legal source point is draggable. */
  draggable?: boolean;
  onDragStart?: () => void;
  onDragEnd?: (info: PanInfo) => void;
  onTap?: () => void;
  testid?: string;
}

/**
 * A single checker. Positioned absolutely by its parent (x/y in px within
 * the board field). Draggable checkers snap back to origin unless the
 * drop handler stages a move (which re-renders the stack without them).
 */
export function Checker({
  color,
  size,
  x,
  y,
  draggable = false,
  onDragStart,
  onDragEnd,
  onTap,
  testid,
}: CheckerProps) {
  const palette =
    color === "white"
      ? "bg-ivory border-ivory-edge"
      : "bg-onyx border-onyx-edge";

  return (
    <motion.div
      data-testid={testid}
      drag={draggable}
      dragSnapToOrigin
      dragMomentum={false}
      dragElastic={0.08}
      onDragStart={draggable ? onDragStart : undefined}
      onDragEnd={draggable ? (_, info) => onDragEnd?.(info) : undefined}
      onTap={draggable && onTap ? onTap : undefined}
      whileDrag={{ scale: 1.18, zIndex: 60 }}
      initial={{ scale: 0.4, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: "spring", stiffness: 500, damping: 30 }}
      className={`absolute rounded-full border-2 ${palette} ${
        draggable
          ? "cursor-grab active:cursor-grabbing touch-none ring-2 ring-gold/80 shadow-[0_0_10px_rgba(245,158,11,0.45)]"
          : ""
      }`}
      style={{
        left: x,
        top: y,
        width: size,
        height: size,
        boxShadow: draggable
          ? undefined
          : "0 1px 3px var(--color-checker-shadow)",
        // Concentric groove like a real checker
        backgroundImage:
          color === "white"
            ? "radial-gradient(circle, transparent 52%, rgba(0,0,0,0.08) 54%, transparent 60%)"
            : "radial-gradient(circle, transparent 52%, rgba(255,255,255,0.10) 54%, transparent 60%)",
      }}
    />
  );
}
