import { Plus, Trash2, X } from "lucide-react";
import type { ChatSession } from "../types";

function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  }
  return date.toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
}

function stripMarkdown(text: string): string {
  return text.replace(/[*_~`#]/g, "").trim();
}

export default function Sidebar({
  open,
  mobileLike,
  sessions,
  currentSessionId,
  onSelect,
  onNew,
  onClose,
  onDelete,
}: {
  open: boolean;
  mobileLike: boolean;
  sessions: ChatSession[];
  currentSessionId: string | null;
  onSelect: (sessionId: string) => void;
  onNew: () => void;
  onClose: () => void;
  onDelete: (sessionId: string) => void;
}) {
  return (
    <aside
      id="chat-sidebar"
      className={`sidebar ${open ? "open" : ""} ${mobileLike ? "mobile-like" : "desktop-like"}`}
    >
      <div className="sidebar-inner">
        <div className="sidebar-head">
          <h2 className="sidebar-title">会话历史</h2>
          {mobileLike && (
            <button
              type="button"
              className="sidebar-close"
              aria-label="关闭会话列表"
              onClick={onClose}
            >
              <X size={14} />
            </button>
          )}
        </div>

        <button className="btn-new" onClick={onNew} type="button">
          <Plus size={14} />
          新会话
        </button>

        <div className="session-list">
          {sessions.map((session) => (
            <div
              key={session.id}
              className={`session-item ${session.id === currentSessionId ? "active" : ""}`}
              onClick={() => onSelect(session.id)}
            >
              <span className="session-title">{stripMarkdown(session.title)}</span>
              <span className="session-meta">
                <span className="session-date">{formatDate(session.updatedAt)}</span>
                <button
                  className="btn-delete"
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    if (window.confirm("确认删除该会话？")) {
                      onDelete(session.id);
                    }
                  }}
                >
                  <Trash2 size={12} />
                </button>
              </span>
            </div>
          ))}

          {sessions.length === 0 && <div className="empty-hint">暂无会话</div>}
        </div>
      </div>
    </aside>
  );
}
