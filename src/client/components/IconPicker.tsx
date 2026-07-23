import { PLAYER_ICONS } from "../../shared/types.ts";
import type { PlayerIcon } from "../../shared/types.ts";
import { ICON_MAP, ICON_COLORS } from "../lib/icons.ts";

interface IconPickerProps {
  selected: PlayerIcon | null;
  onSelect: (icon: PlayerIcon) => void;
  disabledIcons?: PlayerIcon[];
}

export function IconPicker({
  selected,
  onSelect,
  disabledIcons = [],
}: IconPickerProps) {
  return (
    <div className="grid grid-cols-5 gap-2">
      {PLAYER_ICONS.map((icon, i) => {
        const IconComponent = ICON_MAP[icon];
        const colorClass = ICON_COLORS[i % ICON_COLORS.length];
        const isSelected = selected === icon;
        const isDisabled = disabledIcons.includes(icon);

        // Available icons show at full natural color. Selected gets a gold
        // ring. Disabled (someone else took it) gets unambiguously grayed
        // out + a slash so no one mistakes "dimmer than the rest" for a
        // design choice.
        let appearance: string;
        let iconColor: string;
        if (isDisabled) {
          appearance =
            "bg-slate-700/40 border-2 border-dashed border-slate-600 opacity-60 cursor-not-allowed grayscale";
          iconColor = "text-slate-500";
        } else if (isSelected) {
          appearance = `${colorClass} ring-3 ring-gold ring-offset-2 ring-offset-slate-900 scale-110`;
          iconColor = "text-white";
        } else {
          appearance = `${colorClass} hover:scale-105`;
          iconColor = "text-white";
        }

        return (
          <button
            key={icon}
            type="button"
            data-testid={`icon-${icon}`}
            onClick={() => !isDisabled && onSelect(icon)}
            disabled={isDisabled}
            title={isDisabled ? "Taken" : undefined}
            aria-label={isDisabled ? `${icon} (taken)` : icon}
            className={`relative w-12 h-12 rounded-full flex items-center justify-center transition-all duration-200 ${
              isDisabled ? "" : "cursor-pointer"
            } ${appearance}`}
          >
            <IconComponent className={`w-6 h-6 ${iconColor}`} />
            {isDisabled && (
              // A diagonal slash across the tile to unambiguously mark it
              // as unavailable. Uses a CSS linear-gradient so it sits on
              // top of the icon without an extra DOM element doing math.
              <span
                aria-hidden
                className="absolute inset-0 rounded-full pointer-events-none"
                style={{
                  background:
                    "linear-gradient(to top right, transparent calc(50% - 1px), rgb(100 116 139 / 0.9) calc(50% - 1px), rgb(100 116 139 / 0.9) calc(50% + 1px), transparent calc(50% + 1px))",
                }}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
