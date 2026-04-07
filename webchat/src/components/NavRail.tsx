import { Bot, Globe2, Users } from "lucide-react";
import type { View } from "../types";
import UserMenu from "./UserMenu";

interface NavRailProps {
  mode: View;
  onModeChange: (mode: View) => void;
  compact: boolean;
  connState: "disconnected" | "connecting" | "connected";
}

const TABS = [
  { key: "agent" as const, label: "助手", Icon: Bot },
  { key: "team" as const, label: "团队", Icon: Users },
  { key: "city" as const, label: "城市", Icon: Globe2 },
];

export default function NavRail({ mode, onModeChange, compact, connState }: NavRailProps) {
  if (compact) {
    return (
      <nav className="nav-mobile-bar" aria-label="导航">
        {TABS.map(({ key, label, Icon }) => (
          <button
            key={key}
            className={`nav-mobile-tab${mode === key ? " active" : ""}`}
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
    <nav className="nav-rail-v2" aria-label="导航">
      <div className="nav-rail-v2-top">
        <span className="nav-rail-brand">J</span>
      </div>
      <div className="nav-rail-v2-sections">
        {TABS.map(({ key, label, Icon }) => (
          <button
            key={key}
            className={`nav-rail-v2-item${mode === key ? " active" : ""}`}
            onClick={() => onModeChange(key)}
            title={label}
            aria-current={mode === key ? "page" : undefined}
          >
            <Icon size={18} />
          </button>
        ))}
      </div>
      <div className="nav-rail-v2-bottom">
        <div className={`nav-rail-conn ${connState}`} />
        <div className="nav-rail-user-slot">
          <UserMenu compact={compact} />
        </div>
      </div>
    </nav>
  );
}
