import { useState } from "react";
import type { PlayerIcon } from "../../shared/types.ts";
import type { ClientMessage } from "../../shared/protocol.ts";
import { IconPicker } from "./IconPicker.tsx";

interface JoinFormProps {
  playerId: string;
  send: (msg: ClientMessage) => void;
  takenIcons?: PlayerIcon[];
}

export function JoinForm({ playerId, send, takenIcons = [] }: JoinFormProps) {
  const [name, setName] = useState("");
  const [icon, setIcon] = useState<PlayerIcon | null>(null);
  const [joining, setJoining] = useState(false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !icon || joining) return;

    setJoining(true);
    send({
      type: "join",
      playerId,
      name: name.trim(),
      icon,
    });
  }

  const canSubmit = name.trim().length > 0 && icon !== null && !joining;

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6">
      <form
        onSubmit={handleSubmit}
        className="flex flex-col gap-6 max-w-sm w-full"
      >
        <div className="text-center">
          <h2 className="text-2xl font-bold">Join Game</h2>
          <p className="text-slate-400 mt-1">Pick a name and avatar</p>
        </div>

        <div className="flex flex-col gap-2">
          <label
            htmlFor="player-name"
            className="text-sm font-medium text-slate-300"
          >
            Your Name
          </label>
          <input
            id="player-name"
            data-testid="name-input"
            type="text"
            maxLength={12}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Enter your name..."
            autoComplete="off"
            className="w-full px-4 py-3 bg-slate-800 border border-slate-700 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-gold focus:border-transparent text-lg"
          />
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium text-slate-300">
            Your Avatar
          </label>
          <IconPicker
            selected={icon}
            onSelect={setIcon}
            disabledIcons={takenIcons}
          />
        </div>

        <button
          type="submit"
          data-testid="join-btn"
          disabled={!canSubmit}
          className="w-full py-4 px-6 bg-gold hover:bg-amber-400 active:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed text-slate-900 font-bold text-lg rounded-xl transition-colors duration-200 shadow-lg cursor-pointer"
        >
          {joining ? "Joining..." : "Join Game"}
        </button>
      </form>
    </div>
  );
}
