import { useState } from "react";
import { Loader, X } from "lucide-react";
import { createProfile } from "../lib/teams";

const MODEL_OPTIONS = [
  { value: "proxy/claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
  { value: "proxy/claude-opus-4-6", label: "Claude Opus 4.6 (深度推理)" },
  { value: "proxy/gpt-5.4", label: "GPT 5.4" },
  { value: "proxy/gpt-5.3-codex", label: "GPT 5.3 Codex (编码)" },
  { value: "proxy/grok-4.1-fast", label: "Grok 4.1 Fast" },
  { value: "proxy/gemini-3.1-pro-preview", label: "Gemini 3.1 Pro (长上下文)" },
];

const ICON_OPTIONS = [
  { value: "bot", label: "🤖 Bot" },
  { value: "sparkles", label: "✨ Sparkles" },
  { value: "pen-tool", label: "✏️ Pen Tool" },
];

interface CreateAgentModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

export default function CreateAgentModal({ open, onClose, onCreated }: CreateAgentModalProps) {
  const [name, setName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [description, setDescription] = useState("");
  const [icon, setIcon] = useState("bot");
  const [model, setModel] = useState("proxy/claude-sonnet-4-6");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const canSave = name.trim().length > 0 && displayName.trim().length > 0;

  const handleSave = async () => {
    if (!canSave || saving) return;
    setSaving(true);
    setError(null);
    try {
      await createProfile({
        name: name.trim(),
        displayName: displayName.trim(),
        description: description.trim(),
        icon,
        model,
        skills: [],
        workspace: "/data/workspace",
        files: {},
      });
      setName("");
      setDisplayName("");
      setDescription("");
      setIcon("bot");
      setModel("proxy/claude-sonnet-4-6");
      onCreated();
      onClose();
    } catch {
      setError("创建失败，请重试");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="cam-backdrop" onClick={onClose} />
      <div className="cam-modal">
        <header className="cam-header">
          <strong>新建助手</strong>
          <button className="cam-close" onClick={onClose}><X size={16} /></button>
        </header>
        <div className="cam-body">
          <div className="cam-field">
            <label className="cam-label">标识名 <span className="cam-required">*</span></label>
            <input className="cam-input" value={name} onChange={(e) => setName(e.target.value.replace(/[^a-z0-9_-]/g, ""))} placeholder="英文标识，如 researcher" />
            <span className="cam-hint">仅小写字母、数字、-、_</span>
          </div>
          <div className="cam-field">
            <label className="cam-label">显示名称 <span className="cam-required">*</span></label>
            <input className="cam-input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="如：调研助手" />
          </div>
          <div className="cam-field">
            <label className="cam-label">描述</label>
            <input className="cam-input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="一句话描述这个助手的能力" />
          </div>
          <div className="cam-row">
            <div className="cam-field cam-field--half">
              <label className="cam-label">图标</label>
              <select className="cam-input" value={icon} onChange={(e) => setIcon(e.target.value)}>
                {ICON_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div className="cam-field cam-field--half">
              <label className="cam-label">模型</label>
              <select className="cam-input" value={model} onChange={(e) => setModel(e.target.value)}>
                {MODEL_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>
          {error && <div className="cam-error">{error}</div>}
        </div>
        <footer className="cam-footer">
          <button className="cam-cancel" onClick={onClose}>取消</button>
          <button className="cam-submit" disabled={!canSave || saving} onClick={() => void handleSave()}>
            {saving ? <Loader size={14} className="spin-icon" /> : null}
            <span>{saving ? "创建中..." : "创建"}</span>
          </button>
        </footer>
      </div>
    </>
  );
}
