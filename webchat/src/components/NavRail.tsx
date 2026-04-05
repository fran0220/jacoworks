import { Command, Ellipsis, ListTodo, Orbit, Users } from "lucide-react";
import UserMenu from "./UserMenu";
import type { View } from "../types";

const TABS = [
  { key: "workbench", label: "指挥台", Icon: Command },
  { key: "tasks", label: "任务", Icon: ListTodo },
  { key: "team", label: "团队", Icon: Users },
  { key: "observe", label: "观测", Icon: Orbit },
] as const satisfies ReadonlyArray<{ key: View; label: string; Icon: typeof Command }>;

interface NavRailProps {
  view: View;
  onViewChange: (view: View) => void;
  compact: boolean;
  connState: "disconnected" | "connecting" | "connected";
  mobileDrawerOpen?: boolean;
  onToggleMobileDrawer?: () => void;
  onCloseMobileDrawer?: () => void;
}

export default function NavRail({
  view,
  onViewChange,
  compact,
  connState,
  mobileDrawerOpen,
  onToggleMobileDrawer,
  onCloseMobileDrawer,
}: NavRailProps) {
  const selectView = (nextView: View) => {
    onViewChange(nextView);
    onCloseMobileDrawer?.();
  };

  if (compact) {
    return (
      <>
        {mobileDrawerOpen && <div className="nav-mobile-sheet-backdrop" onClick={onCloseMobileDrawer} />}
        <div id="nav-mobile-sheet" className={`nav-mobile-sheet${mobileDrawerOpen ? " open" : ""}`}>
          <div className="nav-mobile-sheet-handle" />
          <div className="nav-mobile-sheet-head">
            <div>
              <strong>更多</strong>
              <span>观测与账号入口</span>
            </div>
            <div className={`nav-rail-conn ${connState}`} />
          </div>

          <div className="nav-mobile-sheet-actions">
            <button
              className={`nav-mobile-sheet-action${view === "observe" ? " active" : ""}`}
              onClick={() => selectView("observe")}
            >
              <Orbit size={18} />
              <span>观测</span>
            </button>
          </div>

          <div className="nav-mobile-sheet-user">
            <UserMenu compact />
          </div>

          <div className="nav-mobile-sheet-status">
            <span className={`nav-rail-conn ${connState}`} />
            <span>{connState === "connected" ? "协作在线" : connState === "connecting" ? "连接中" : "连接中断"}</span>
          </div>
        </div>

        <nav className="nav-mobile-bar" aria-label="主导航">
          {TABS.slice(0, 3).map(({ key, label, Icon }) => (
            <button
              key={key}
              className={`nav-mobile-tab${view === key ? " active" : ""}`}
              onClick={() => selectView(key)}
              aria-current={view === key ? "page" : undefined}
            >
              <Icon size={18} />
              <span>{label}</span>
            </button>
          ))}
          <button
            className={`nav-mobile-tab${view === "observe" || mobileDrawerOpen ? " active" : ""}`}
            onClick={onToggleMobileDrawer}
            aria-expanded={mobileDrawerOpen}
            aria-controls="nav-mobile-sheet"
          >
            <Ellipsis size={18} />
            <span>更多</span>
          </button>
        </nav>
      </>
    );
  }

  return (
    <nav className="nav-rail-v2" aria-label="主导航">
      <div className="nav-rail-v2-top">
        <span className="nav-rail-brand">J</span>
      </div>

      <div className="nav-rail-v2-sections">
        {TABS.map(({ key, label, Icon }) => (
          <button
            key={key}
            className={`nav-rail-v2-item${view === key ? " active" : ""}`}
            onClick={() => onViewChange(key)}
            title={label}
            aria-current={view === key ? "page" : undefined}
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
