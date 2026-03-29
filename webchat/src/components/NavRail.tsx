import { Command, ListTodo, Orbit, Users, X, type LucideIcon } from "lucide-react";
import UserMenu from "./UserMenu";
import type { View } from "../types";

const TABS: { key: View; label: string; Icon: LucideIcon }[] = [
  { key: "workbench", label: "指挥台", Icon: Command },
  { key: "tasks", label: "任务", Icon: ListTodo },
  { key: "team", label: "团队", Icon: Users },
  { key: "observe", label: "观测", Icon: Orbit },
];

export default function NavRail({
  view,
  compact,
  connState,
  onViewChange,
  mobileDrawerOpen,
  onCloseMobileDrawer,
}: {
  view: View;
  compact: boolean;
  connState: "disconnected" | "connecting" | "connected";
  onViewChange: (view: View) => void;
  mobileDrawerOpen?: boolean;
  onCloseMobileDrawer?: () => void;
}) {
  if (compact) {
    return (
      <>
        {mobileDrawerOpen && <div className="nav-drawer-backdrop" onClick={onCloseMobileDrawer} />}
        <nav className={`nav-drawer${mobileDrawerOpen ? " open" : ""}`}>
          <div className="nav-drawer-head">
            <span className="nav-drawer-brand">JAcoworks</span>
            <button className="nav-drawer-close" onClick={onCloseMobileDrawer}>
              <X size={18} />
            </button>
          </div>
          <div className="nav-drawer-tabs">
            {TABS.map(({ key, label, Icon }) => (
              <button
                key={key}
                className={`nav-drawer-btn${view === key ? " active" : ""}`}
                onClick={() => {
                  onViewChange(key);
                  onCloseMobileDrawer?.();
                }}
              >
                <Icon size={18} />
                <span>{label}</span>
              </button>
            ))}
          </div>
          <div className="nav-drawer-bottom">
            <div className={`nav-rail-conn ${connState}`} />
            <UserMenu compact={compact} />
          </div>
        </nav>
      </>
    );
  }

  return (
    <nav className="nav-rail">
      <div className="nav-rail-top">
        <span className="nav-rail-brand">J</span>
      </div>
      <div className="nav-rail-tabs">
        {TABS.map(({ key, label, Icon }) => (
          <button
            key={key}
            className={`nav-rail-btn${view === key ? " active" : ""}`}
            onClick={() => onViewChange(key)}
            title={label}
          >
            <Icon size={18} />
          </button>
        ))}
      </div>
      <div className="nav-rail-bottom">
        <div className={`nav-rail-conn ${connState}`} />
        <div className="nav-rail-user-slot">
          <UserMenu compact={compact} />
        </div>
      </div>
    </nav>
  );
}
