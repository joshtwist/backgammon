import { motion } from "framer-motion";
import type { BoardState, Color } from "../../shared/types.ts";
import type { PlayerView } from "../../shared/protocol.ts";
import { pipCount } from "../../shared/engine/board.ts";
import { OFF } from "../../shared/types.ts";
import { ICON_MAP, ICON_COLORS } from "../lib/icons.ts";
import { PLAYER_ICONS } from "../../shared/types.ts";

interface PlayerHUDProps {
  player: PlayerView;
  board: BoardState;
  isTheirTurn: boolean;
  isYou?: boolean;
}

/** Compact status bar for one player: avatar, name, pips, off count. */
export function PlayerHUD({
  player,
  board,
  isTheirTurn,
  isYou = false,
}: PlayerHUDProps) {
  const Icon = ICON_MAP[player.icon];
  const color =
    ICON_COLORS[
      Math.max(0, PLAYER_ICONS.indexOf(player.icon)) % ICON_COLORS.length
    ];
  const pips = pipCount(board, player.color);
  const off = board[player.color][OFF];

  return (
    <div
      data-testid={isYou ? "hud-you" : "hud-opponent"}
      className="flex items-center gap-3 px-4 py-2"
    >
      <div className="relative">
        <div
          className={`w-9 h-9 rounded-full flex items-center justify-center ${color}`}
        >
          <Icon className="w-5 h-5 text-white" />
        </div>
        {isTheirTurn && (
          <motion.div
            animate={{ scale: [1, 1.25, 1], opacity: [0.9, 0.4, 0.9] }}
            transition={{ repeat: Infinity, duration: 1.6 }}
            className="absolute -inset-1 rounded-full border-2 border-gold pointer-events-none"
          />
        )}
        <span
          className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-slate-900 ${
            player.connected ? "bg-green-500" : "bg-slate-500"
          }`}
          title={player.connected ? "online" : "offline"}
        />
      </div>

      <div className="flex-1 min-w-0">
        <div className="font-semibold text-sm truncate flex items-center gap-1.5">
          {player.name}
          {isYou && <span className="text-slate-400 font-normal">(you)</span>}
          <span
            className={`inline-block w-3.5 h-3.5 rounded-full border ${
              player.color === "white"
                ? "bg-ivory border-ivory-edge"
                : "bg-onyx border-onyx-edge"
            }`}
          />
        </div>
        <div className="text-xs text-slate-400 tabular-nums">
          {pips} pips
          <span data-testid={`off-count-${player.color}`}>
            {off > 0 ? ` · ${off} off` : ""}
          </span>
        </div>
      </div>
    </div>
  );
}
