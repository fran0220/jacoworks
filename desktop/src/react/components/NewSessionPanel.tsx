import { ArrowRight, ChevronDown, FolderOpen } from "lucide-react";
import { useState } from "react";
import { DEFAULT_MODEL, MODEL_OPTIONS } from "../lib/config";
import { folderName, selectFolder } from "../lib/cowork";
import { createSession } from "../lib/sessions";
import type { ChatSession } from "../types";

export default function NewSessionPanel({
  onSessionCreated,
}: {
  onSessionCreated: (session: ChatSession, firstMessage: string) => void;
}) {
  const [task, setTask] = useState("");
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [workspacePath, setWorkspacePath] = useState("");
  const [loading, setLoading] = useState(false);

  const canSend = task.trim().length > 0 && !loading;

  const handleSend = async () => {
    if (!canSend) return;
    setLoading(true);
    try {
      const session = await createSession({ model, workspacePath: workspacePath || undefined });
      onSessionCreated(session, task.trim());
    } finally {
      setLoading(false);
    }
  };

  const handleSelectFolder = async () => {
    const selected = await selectFolder();
    if (selected) setWorkspacePath(selected);
  };

  return (
    <div className="new-session">
      <div className="ns-header">
        <h1>开始新的任务</h1>
        <p className="ns-subtitle">描述你的需求，AI 来帮你完成</p>
      </div>

      <div className="ns-input-card">
        <textarea
          rows={3}
          disabled={loading}
          value={task}
          onChange={(e) => setTask(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder="有什么可以帮你的？"
        />

        <div className="ns-toolbar">
          <div className="ns-toolbar-left">
            <button
              className="ns-btn-folder"
              onClick={handleSelectFolder}
              disabled={loading}
              title={workspacePath || "选择工作目录"}
            >
              <FolderOpen size={14} />
              <span className="ns-folder-label">
                {workspacePath ? folderName(workspacePath) : "选择目录"}
              </span>
              <ChevronDown size={12} />
            </button>
          </div>
          <div className="ns-toolbar-right">
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              disabled={loading}
              className="model-select"
            >
              {MODEL_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <button className="btn-go" disabled={!canSend} onClick={handleSend}>
              开始
              <ArrowRight size={14} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
