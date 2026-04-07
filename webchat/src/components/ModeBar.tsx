import { Bot, Globe2, Users } from "lucide-react";
import type { AppMode } from "../types";
import UserMenu from "./UserMenu";

interface ModeBarProps {
  mode: AppMode;
  onModeChange: (mode: AppMode) => void;
  compact: boolean;
  connState: "disconnected" | "connecting" | "connected";
}

const MODES = [
  { key: "agent" as const, label: "Agent", Icon: Bot },
  { key: "team" as const, label: "团队", Icon: Users },
  { key: "city" as const, label: "城市", Icon: Globe2 },
];

export default function ModeBar({ mode, onModeChange, compact, connState }: ModeBarProps) {
  if (compact) {
    return (
      <nav className="mode-mobile-bar" aria-label="模式切换">
        {MODES.map(({ key, label, Icon }) => (
          <button
            key={key}
            className={`mode-mobile-tab${mode === key ? " active" : ""}`}
            onClick={() => onModeChange(key)}
            aria-current={mode === key ? "page" : undefined}
          >
            <Icon size={18} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
    );
  }

  return (
    <nav className="mode-bar" aria-label="模式切换">
      <div className="mode-bar-top">
        <span className="nav-rail-brand">J</span>
      </div>
      <div className="mode-bar-sections">
        {MODES.map(({ key, label, Icon }) => (
          <button
            key={key}
            className={`mode-bar-item${mode === key ? " active" : ""}`}
            onClick={() => onModeChange(key)}
            title={label}
            aria-current={mode === key ? "page" : undefined}
          >
            <Icon size={18} />
          </button>
        ))}
      </div>
      <div className="mode-bar-bottom">
        <div className={`nav-rail-conn ${connState}`} />
        <div className="nav-rail-user-slot">
          <UserMenu compact={compact} />
        </div>
      </div>
    </nav>
  );
}
