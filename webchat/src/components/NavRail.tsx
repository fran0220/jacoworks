import { MessageSquare, Users, ListTodo, Box, Activity, Monitor, Orbit, Globe } from "lucide-react";
import type { ActiveTab } from "../App";
import { USER_NAME } from "../lib/config";

const TABS: { key: ActiveTab; label: string; Icon: typeof MessageSquare }[] = [
  { key: "chat", label: "对话", Icon: MessageSquare },
  { key: "teams", label: "团队", Icon: Users },
  { key: "cron", label: "任务", Icon: ListTodo },
  { key: "desktop", label: "桌面", Icon: Monitor },
  { key: "container", label: "容器", Icon: Box },
  { key: "feed", label: "动态", Icon: Activity },
  { key: "observatory", label: "观测站", Icon: Orbit },
  { key: "city", label: "数字之城", Icon: Globe },
];

export default function NavRail({
  activeTab,
  connState,
  onTabChange,
}: {
  activeTab: ActiveTab;
  connState: "disconnected" | "connecting" | "connected";
  onTabChange: (tab: ActiveTab) => void;
}) {
  const initial = (USER_NAME || "U").charAt(0).toUpperCase();

  return (
    <nav className="nav-rail">
      <div className="nav-rail-top">
        <span className="nav-rail-brand">J</span>
      </div>
      <div className="nav-rail-tabs">
        {TABS.map(({ key, label, Icon }) => (
          <button
            key={key}
            className={`nav-rail-btn${activeTab === key ? " active" : ""}`}
            onClick={() => onTabChange(key)}
            title={label}
          >
            <Icon size={18} />
          </button>
        ))}
      </div>
      <div className="nav-rail-bottom">
        <div className={`nav-rail-conn ${connState}`} />
        <div className="nav-rail-avatar" title={USER_NAME || "用户"}>{initial}</div>
        <form method="post" action="/logout" style={{ margin: 0 }}>
          <button type="submit" className="nav-rail-logout" title="退出登录">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
          </button>
        </form>
      </div>
    </nav>
  );
}
