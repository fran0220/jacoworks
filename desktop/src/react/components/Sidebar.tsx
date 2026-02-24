import { Plus, Trash2 } from "lucide-react";
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
  sessions,
  currentSessionId,
  onSelect,
  onNew,
  onDelete,
}: {
  sessions: ChatSession[];
  currentSessionId: string | null;
  onSelect: (sessionId: string) => void;
  onNew: () => void;
  onDelete: (sessionId: string) => void;
}) {
  return (
    <aside className="sidebar">
      <button className="btn-new" onClick={onNew}>
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
    </aside>
  );
}
