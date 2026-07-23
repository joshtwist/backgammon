import { motion } from "framer-motion";

/** Pip layout per face on a 3x3 grid (row-major cells 0..8). */
const CELLS: Record<number, number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

export function DiePips({ value }: { value: number }) {
  const on = new Set(CELLS[value] ?? []);
  return (
    <div className="grid grid-cols-3 grid-rows-3 gap-[2px] w-[70%] h-[70%]">
      {Array.from({ length: 9 }).map((_, i) => (
        <div key={i} className="flex items-center justify-center">
          {on.has(i) && (
            <div className="w-[70%] h-[70%] rounded-full bg-current" />
          )}
        </div>
      ))}
    </div>
  );
}

interface DieFaceProps {
  value: number | null;
  size?: "sm" | "md" | "lg";
  /** Dim the die (e.g. already used this turn). */
  spent?: boolean;
  /** Pop-in animation key: re-mounts animate a little tumble. */
  animateIn?: boolean;
  testid?: string;
}

const SIZES = {
  sm: "w-8 h-8 rounded-md",
  md: "w-11 h-11 rounded-lg",
  lg: "w-16 h-16 rounded-xl",
};

export function DieFace({
  value,
  size = "md",
  spent = false,
  animateIn = false,
  testid,
}: DieFaceProps) {
  return (
    <motion.div
      data-testid={testid}
      data-die-value={value ?? ""}
      initial={animateIn ? { rotate: -25, scale: 0.4, opacity: 0 } : false}
      animate={{ rotate: 0, scale: 1, opacity: 1 }}
      transition={{ type: "spring", stiffness: 400, damping: 18 }}
      className={`${SIZES[size]} flex items-center justify-center shadow-md transition-colors ${
        spent
          ? "bg-slate-400/40 text-slate-600"
          : "bg-white text-slate-900"
      }`}
    >
      {value === null ? (
        <span className="text-slate-400 font-bold text-lg">?</span>
      ) : (
        <DiePips value={value} />
      )}
    </motion.div>
  );
}
