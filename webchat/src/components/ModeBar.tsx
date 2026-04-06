import { Command, Globe2, Settings } from "lucide-react";
import UserMenu from "./UserMenu";

export type AppMode = "workspace" | "city";

interface ModeBarProps {
  mode: AppMode;
  onModeChange: (mode: AppMode) => void;
  compact: boolean;
  connState: "disconnected" | "connecting" | "connected";
  onToggleConfig: () => void;
}

const MODES = [
  { key: "workspace" as const, label: "工作台", Icon: Command },
  { key: "city" as const, label: "城市", Icon: Globe2 },
];

export default function ModeBar({
  mode,
  onModeChange,
  compact,
  connState,
  onToggleConfig,
}: ModeBarProps) {
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
        <button className="mode-mobile-tab" onClick={onToggleConfig}>
          <Settings size={18} />
          <span>配置</span>
        </button>
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
        <button
          className="mode-bar-item"
          onClick={onToggleConfig}
          title="配置"
        >
          <Settings size={18} />
        </button>
        <div className={`nav-rail-conn ${connState}`} />
        <div className="nav-rail-user-slot">
          <UserMenu compact={compact} />
        </div>
      </div>
    </nav>
  );
}

/*
 * ===== Add to index.css =====
 *
 * --- Desktop (sidebar) ---
 *
 * .mode-bar {
 *   width: 52px;
 *   background: #2a2520;
 *   display: flex;
 *   flex-direction: column;
 *   flex-shrink: 0;
 *   z-index: 100;
 *   overflow: visible;
 * }
 *
 * .mode-bar-top {
 *   display: flex;
 *   align-items: center;
 *   justify-content: center;
 *   height: 48px;
 *   flex-shrink: 0;
 * }
 *
 * .mode-bar-sections {
 *   flex: 1;
 *   display: flex;
 *   flex-direction: column;
 *   align-items: center;
 *   gap: 0.25rem;
 *   padding: 0.375rem 0;
 * }
 *
 * .mode-bar-bottom {
 *   display: flex;
 *   flex-direction: column;
 *   align-items: center;
 *   gap: 0.5rem;
 *   padding: 0.625rem 0;
 *   border-top: 1px solid rgba(255, 255, 255, 0.08);
 * }
 *
 * .mode-bar-item {
 *   width: 42px;
 *   height: 42px;
 *   display: flex;
 *   align-items: center;
 *   justify-content: center;
 *   border-radius: 0.5rem;
 *   color: rgba(255, 255, 255, 0.45);
 *   transition: all 0.15s;
 * }
 *
 * .mode-bar-item:hover {
 *   color: rgba(255, 255, 255, 0.8);
 *   background: rgba(255, 255, 255, 0.08);
 * }
 *
 * .mode-bar-item.active {
 *   color: #fff;
 *   background: var(--accent);
 * }
 *
 * --- Mobile (bottom bar) ---
 *
 * .mode-mobile-bar {
 *   position: fixed;
 *   left: 0;
 *   right: 0;
 *   bottom: 0;
 *   z-index: 93;
 *   display: none;
 *   grid-template-columns: repeat(3, minmax(0, 1fr));
 *   gap: 0.5rem;
 *   padding: 0.65rem 0.875rem calc(0.75rem + env(safe-area-inset-bottom, 0px));
 *   background: rgba(250, 247, 244, 0.94);
 *   border-top: 1px solid rgba(31, 24, 19, 0.08);
 *   box-shadow: 0 -10px 28px rgba(32, 22, 13, 0.08);
 *   backdrop-filter: blur(18px);
 * }
 *
 * .mode-mobile-tab {
 *   min-height: 52px;
 *   display: flex;
 *   flex-direction: column;
 *   align-items: center;
 *   justify-content: center;
 *   gap: 0.35rem;
 *   border-radius: 0.95rem;
 *   color: rgba(75, 85, 99, 0.82);
 *   font-size: 0.74rem;
 *   font-weight: 600;
 * }
 *
 * .mode-mobile-tab:hover {
 *   background: rgba(0, 0, 0, 0.04);
 * }
 *
 * .mode-mobile-tab.active {
 *   color: var(--accent);
 *   background: rgba(196, 114, 74, 0.12);
 * }
 *
 * @media (max-width: 768px) {
 *   .mode-bar { display: none; }
 *   .mode-mobile-bar { display: grid; }
 * }
 */
