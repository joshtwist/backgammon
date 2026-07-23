import { useState } from "react";
import { Share2, Check, Copy } from "lucide-react";

interface ShareButtonProps {
  gameId: string;
  /**
   * "primary" = big gold CTA (use when this is the most important action,
   *   e.g. the host hasn't got an opponent yet).
   * "secondary" = muted slate (use once Start Game becomes the real CTA).
   */
  emphasis?: "primary" | "secondary";
}

export function ShareButton({
  gameId,
  emphasis = "primary",
}: ShareButtonProps) {
  const [copied, setCopied] = useState(false);
  const url =
    typeof window !== "undefined"
      ? `${window.location.origin}/${gameId}`
      : "";

  async function handleShare() {
    // Prefer the native share sheet on mobile (Safari/Chrome).
    // We only send title + url -- no `text` field, so messaging apps don't
    // prepend extra copy to the URL (which can confuse the recipient if
    // they end up copy-pasting it).
    if (navigator.share) {
      try {
        await navigator.share({
          title: "Join my Backgammon game!",
          url,
        });
        return;
      } catch {
        // User cancelled share sheet -- fall through to clipboard
      }
    }

    // Fallback: copy to clipboard
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard not available -- best-effort no-op
    }
  }

  const hasShare = typeof navigator !== "undefined" && "share" in navigator;
  const Icon = copied ? Check : hasShare ? Share2 : Copy;
  const label = copied
    ? "Copied!"
    : hasShare
    ? "Invite a Friend"
    : "Copy Invite Link";

  if (emphasis === "primary") {
    return (
      <button
        onClick={handleShare}
        className="w-full py-5 px-6 bg-gold hover:bg-amber-400 active:bg-amber-500 text-slate-900 font-bold text-lg rounded-2xl transition-all duration-200 flex items-center justify-center gap-3 cursor-pointer shadow-lg shadow-gold/25 hover:shadow-gold/40 hover:scale-[1.02] active:scale-[0.99]"
      >
        <Icon className="w-6 h-6" strokeWidth={2.5} />
        <span>{label}</span>
      </button>
    );
  }

  return (
    <button
      onClick={handleShare}
      className="w-full py-3 px-6 bg-slate-800 hover:bg-slate-700 active:bg-slate-900 border border-slate-700 text-white font-semibold rounded-xl transition-colors duration-200 flex items-center justify-center gap-2 cursor-pointer"
    >
      <Icon className="w-5 h-5" />
      {label}
    </button>
  );
}
