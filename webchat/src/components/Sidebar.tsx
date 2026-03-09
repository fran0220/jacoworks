import { MessageSquare, Users, Clock, Box } from "lucide-react";
import type { ChatSession } from "../types";
import type { ActiveTab } from "../App";
import { USER_NAME } from "../lib/config";

function stripMarkdown(text: string): string {
  return text.replace(/[#*_~`>\[\]()!]/g, "").trim();
}

const TABS: { key: ActiveTab; label: string; Icon: typeof MessageSquare }[] = [
  { key: "chat", label: "对话", Icon: MessageSquare },
  { key: "teams", label: "团队", Icon: Users },
  { key: "cron", label: "任务", Icon: Clock },
  { key: "container", label: "容器", Icon: Box },
];

export default function Sidebar({
  sessions,
  activeId,
  activeTab,
  onSelect,
  onNew,
  onDelete,
  onTabChange,
  open,
}: {
  sessions: ChatSession[];
  activeId: string | null;
  activeTab: ActiveTab;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onTabChange: (tab: ActiveTab) => void;
  open?: boolean;
}) {
  return (
    <div className={`sidebar${open ? " open" : ""}`}>
      <div className="sidebar-header">
        <span className="sidebar-title">JAcoworks</span>
        {activeTab === "chat" && (
          <button className="new-chat-btn" onClick={onNew}>新会话</button>
        )}
      </div>

      {/* Tab navigation */}
      <div className="sidebar-tabs">
        {TABS.map(({ key, label, Icon }) => (
          <button
            key={key}
            className={`sidebar-tab${activeTab === key ? " active" : ""}`}
            onClick={() => onTabChange(key)}
          >
            <Icon size={14} />
            <span>{label}</span>
          </button>
        ))}
      </div>

      {/* Session list only visible in chat tab */}
      {activeTab === "chat" && (
        <div className="session-list">
          {sessions.map((s) => (
            <div
              key={s.id}
              className={`session-item${s.id === activeId ? " active" : ""}`}
              onClick={() => onSelect(s.id)}
            >
              <span>{stripMarkdown(s.title) || "新会话"}</span>
              <button
                className="session-delete"
                onClick={(e) => { e.stopPropagation(); onDelete(s.id); }}
              >✕</button>
            </div>
          ))}
          {sessions.length === 0 && (
            <div style={{ padding: "1rem", textAlign: "center", color: "var(--text-muted)", fontSize: "0.8125rem" }}>
              暂无会话
            </div>
          )}
        </div>
      )}

      {/* Non-chat tabs: empty space for the main content area */}
      {activeTab !== "chat" && <div className="session-list" />}

      <div className="sidebar-footer">
        <span>{USER_NAME}</span>
        <form method="post" action="/logout" style={{ margin: 0 }}>
          <button type="submit" className="logout-btn">退出</button>
        </form>
      </div>
    </div>
  );
}
