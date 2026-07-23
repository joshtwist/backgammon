import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { DiePips } from "./Dice.tsx";

export function HomePage() {
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);

  async function handleCreate() {
    if (creating) return;
    setCreating(true);
    try {
      const res = await fetch("/api/game", { method: "POST" });
      if (!res.ok) throw new Error("Failed to create game");
      const data = await res.json();
      navigate(`/${data.gameId}`);
    } catch {
      setCreating(false);
    }
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6">
      <div className="flex flex-col items-center gap-8 max-w-sm w-full">
        {/* Logo area */}
        <div className="flex flex-col items-center gap-4">
          <div className="w-20 h-20 rounded-2xl bg-wood flex items-end justify-center gap-1.5 shadow-lg overflow-hidden px-3 pb-0">
            <div
              className="w-4 h-12 bg-point-light"
              style={{ clipPath: "polygon(0 100%, 100% 100%, 50% 0)" }}
            />
            <div
              className="w-4 h-12 bg-point-dark"
              style={{ clipPath: "polygon(0 100%, 100% 100%, 50% 0)" }}
            />
            <div
              className="w-4 h-12 bg-point-light"
              style={{ clipPath: "polygon(0 100%, 100% 100%, 50% 0)" }}
            />
          </div>
          <h1 className="text-4xl font-bold tracking-tight">Backgammon</h1>
          <p className="text-slate-400 text-center text-lg">
            No accounts. No installs. Just share a link and play.
          </p>
        </div>

        {/* Board visual + CTA */}
        <div className="w-full rounded-2xl bg-felt/30 border border-felt-light/40 p-8 flex flex-col items-center gap-6">
          <div className="flex gap-3 items-center">
            <div className="w-10 h-10 rounded-full bg-ivory border-2 border-ivory-edge shadow-md" />
            <div className="w-12 h-12 rounded-lg bg-white text-slate-900 flex items-center justify-center shadow-md">
              <DiePips value={6} />
            </div>
            <div className="w-12 h-12 rounded-lg bg-white text-slate-900 flex items-center justify-center shadow-md">
              <DiePips value={5} />
            </div>
            <div className="w-10 h-10 rounded-full bg-onyx border-2 border-onyx-edge shadow-md" />
          </div>

          <button
            data-testid="create-game-btn"
            onClick={handleCreate}
            disabled={creating}
            className="w-full py-4 px-6 bg-gold hover:bg-amber-400 active:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed text-slate-900 font-bold text-lg rounded-xl transition-colors duration-200 shadow-lg cursor-pointer"
          >
            {creating ? "Creating..." : "Create New Game"}
          </button>

          <p className="text-slate-500 text-sm text-center">
            Two players. All the classic rules. Best on your phone.
          </p>
        </div>
      </div>
    </div>
  );
}

