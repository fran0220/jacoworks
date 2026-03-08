import type { ChatSession } from "../types";
import { USER_NAME } from "../lib/config";

function stripMarkdown(text: string): string {
  return text.replace(/[#*_~`>\[\]()!]/g, "").trim();
}

export default function Sidebar({
  sessions,
  activeId,
  onSelect,
  onNew,
  onDelete,
}: {
  sessions: ChatSession[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <span className="sidebar-title">会话列表</span>
        <button className="new-chat-btn" onClick={onNew}>新会话</button>
      </div>
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
      <div className="sidebar-footer">
        <span>{USER_NAME}</span>
        <form method="post" action="/logout" style={{ margin: 0 }}>
          <button type="submit" className="logout-btn">退出</button>
        </form>
      </div>
    </div>
  );
}
