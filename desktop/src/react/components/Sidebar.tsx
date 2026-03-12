import { useMemo, useState } from "react";
import { EyeOff, Plus, Trash2, X } from "lucide-react";
import type { ChatSession } from "../types";
import ConfirmDialog from "./ConfirmDialog";

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

interface SessionGroup {
  label: string;
  sessions: ChatSession[];
}

function groupSessions(sessions: ChatSession[]): SessionGroup[] {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 86_400_000;
  const startOf7Days = startOfToday - 7 * 86_400_000;
  const startOf30Days = startOfToday - 30 * 86_400_000;

  const groups: Record<string, ChatSession[]> = {};
  const monthGroups: Map<string, ChatSession[]> = new Map();

  for (const s of sessions) {
    const t = s.updatedAt;
    let key: string;
    if (t >= startOfToday) {
      key = "今天";
    } else if (t >= startOfYesterday) {
      key = "昨天";
    } else if (t >= startOf7Days) {
      key = "过去 7 天";
    } else if (t >= startOf30Days) {
      key = "过去 30 天";
    } else {
      const d = new Date(t);
      key = `${d.getFullYear()}年${d.getMonth() + 1}月`;
      if (!monthGroups.has(key)) monthGroups.set(key, []);
      monthGroups.get(key)!.push(s);
      continue;
    }
    (groups[key] ??= []).push(s);
  }

  const result: SessionGroup[] = [];
  for (const label of ["今天", "昨天", "过去 7 天", "过去 30 天"]) {
    if (groups[label]?.length) result.push({ label, sessions: groups[label] });
  }
  for (const [label, items] of monthGroups) {
    result.push({ label, sessions: items });
  }
  return result;
}

export default function Sidebar({
  open,
  mobileLike,
  sessions,
  currentSessionId,
  streamingSessions,
  unreadSessions,
  onSelect,
  onNew,
  onClose,
  onDelete,
}: {
  open: boolean;
  mobileLike: boolean;
  sessions: ChatSession[];
  currentSessionId: string | null;
  streamingSessions: Set<string>;
  unreadSessions: Set<string>;
  onSelect: (sessionId: string) => void;
  onNew: () => void;
  onClose: () => void;
  onDelete: (sessionId: string) => void;
}) {
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const grouped = useMemo(() => groupSessions(sessions), [sessions]);

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
          {grouped.map((group) => (
            <div key={group.label} className="session-group">
              <div className="session-group-label">{group.label}</div>
              {group.sessions.map((session) => {
                const isStreaming = streamingSessions.has(session.id);
                const isUnread = !isStreaming && unreadSessions.has(session.id);
                return (
                <div
                  key={session.id}
                  className={`session-item ${session.id === currentSessionId ? "active" : ""}${session.anonymous ? " anonymous" : ""}`}
                  onClick={() => onSelect(session.id)}
                >
                  {isStreaming && <span className="session-status session-status--streaming" title="生成中" />}
                  {isUnread && <span className="session-status session-status--unread" title="有新回复" />}
                  {session.anonymous && (
                    <span className="session-type-icon" title="匿名">
                      <EyeOff size={12} />
                    </span>
                  )}
                  <span className="session-title">{stripMarkdown(session.title)}</span>
                  <span className="session-meta">
                    <span className="session-date">{formatDate(session.updatedAt)}</span>
                    <button
                      className="btn-delete"
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        setDeleteTarget(session.id);
                      }}
                    >
                      <Trash2 size={12} />
                    </button>
                  </span>
                </div>
                );
              })}
            </div>
          ))}

          {sessions.length === 0 && <div className="empty-hint">暂无会话</div>}
        </div>
      </div>
      {deleteTarget && (
        <ConfirmDialog
          title="删除会话"
          message="确认删除该会话？此操作不可恢复。"
          confirmLabel="删除"
          danger
          onConfirm={() => {
            onDelete(deleteTarget);
            setDeleteTarget(null);
          }}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </aside>
  );
}
