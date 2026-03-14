import { Plus } from "lucide-react";
import type { ChatSession } from "../types";

function stripMarkdown(text: string): string {
  return text.replace(/[#*_~`>\[\]()!]/g, "").trim();
}

export default function Sidebar({
  sessions,
  activeId,
  onSelect,
  onNew,
  onDelete,
  open,
}: {
  sessions: ChatSession[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  open?: boolean;
}) {
  return (
    <aside className={`context-panel${open ? " open" : ""}`}>
      <div className="context-panel-header">
        <span className="context-panel-title">会话</span>
        <button className="context-panel-action" onClick={onNew} title="新建会话">
          <Plus size={15} />
        </button>
      </div>
      <div className="context-panel-list">
        {sessions.map((s) => (
          <div
            key={s.id}
            className={`context-panel-item${s.id === activeId ? " active" : ""}`}
            onClick={() => onSelect(s.id)}
          >
            <span>{stripMarkdown(s.title) || "新会话"}</span>
            <button
              className="context-panel-item-delete"
              onClick={(e) => { e.stopPropagation(); onDelete(s.id); }}
            >✕</button>
          </div>
        ))}
        {sessions.length === 0 && (
          <div className="context-panel-empty">暂无会话</div>
        )}
      </div>
    </aside>
  );
}
