import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader, Save, X } from "lucide-react";
import { fetchProfileDetail, updateProfile, type ProfileDetail } from "../lib/teams";

interface SettingsDrawerProps {
  open: boolean;
  onClose: () => void;
  profileName: string;
  onSaved?: () => void;
}

const KNOWN_FILES = [
  { key: "SOUL.md", label: "性格 (SOUL)" },
  { key: "IDENTITY.md", label: "身份 (IDENTITY)" },
  { key: "USER.md", label: "用户 (USER)" },
  { key: "AGENTS.md", label: "工作指引 (AGENTS)" },
  { key: "TOOLS.md", label: "工具 (TOOLS)" },
];

const ICON_OPTIONS = [
  { value: "bot", label: "🤖 Bot" },
  { value: "sparkles", label: "✨ Sparkles" },
  { value: "pen-tool", label: "✏️ Pen Tool" },
];

const MODEL_OPTIONS = [
  { value: "proxy/claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
  { value: "proxy/claude-opus-4-6", label: "Claude Opus 4.6 (深度推理)" },
  { value: "proxy/gpt-5.4", label: "GPT 5.4" },
  { value: "proxy/gpt-5.3-codex", label: "GPT 5.3 Codex (编码)" },
  { value: "proxy/grok-4.1-fast", label: "Grok 4.1 Fast" },
  { value: "proxy/gemini-3.1-pro-preview", label: "Gemini 3.1 Pro (长上下文)" },
  { value: "proxy/claude-haiku-4-5-20251001", label: "Claude Haiku 4.5 (高速)" },
];

export default function SettingsDrawer({ open, onClose, profileName, onSaved }: SettingsDrawerProps) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<ProfileDetail | null>(null);
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());

  const isReadOnly = !profileName;

  useEffect(() => {
    if (!open || !profileName) {
      setForm(null);
      return;
    }

    let cancelled = false;
    setLoading(true);

    fetchProfileDetail(profileName)
      .then((d) => {
        if (cancelled) return;
        setForm({ ...d, files: { ...d.files } });
      })
      .catch(() => {
        if (!cancelled) setForm(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [open, profileName]);

  const setField = useCallback(<K extends keyof ProfileDetail>(key: K, value: ProfileDetail[K]) => {
    setForm((prev) => prev ? { ...prev, [key]: value } : prev);
  }, []);

  const setFile = useCallback((key: string, value: string) => {
    setForm((prev) => prev ? { ...prev, files: { ...prev.files, [key]: value } } : prev);
  }, []);

  const toggleFileSection = useCallback((key: string) => {
    setExpandedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const addFile = useCallback((key: string) => {
    setFile(key, "");
    setExpandedFiles((prev) => new Set(prev).add(key));
  }, [setFile]);

  const removeFile = useCallback((key: string) => {
    setForm((prev) => {
      if (!prev) return prev;
      const next = { ...prev.files };
      delete next[key];
      return { ...prev, files: next };
    });
    setExpandedFiles((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  }, []);

  const activeFileKeys = useMemo(
    () => KNOWN_FILES.filter((f) => form && f.key in form.files).map((f) => f.key),
    [form],
  );

  const addableFiles = useMemo(
    () => KNOWN_FILES.filter((f) => !form || !(f.key in form.files)),
    [form],
  );

  const handleSave = useCallback(async () => {
    if (!form || !profileName || isReadOnly) return;
    setSaving(true);
    try {
      const { type: _type, ...body } = form;
      await updateProfile(profileName, body);
      onSaved?.();
      onClose();
    } catch {
      // save failed silently
    } finally {
      setSaving(false);
    }
  }, [form, profileName, isReadOnly, onSaved, onClose]);

  return (
    <>
      {open && <div className="sd-backdrop" onClick={onClose} />}
      <aside className={`sd-drawer${open ? " sd-drawer--open" : ""}`}>
        <header className="sd-header">
          <strong>设置</strong>
          <button className="sd-close-btn" onClick={onClose} title="关闭">
            <X size={16} />
          </button>
        </header>

        <div className="sd-body">
          {loading && (
            <div className="sd-loading">
              <Loader size={20} className="spin-icon" />
              <span>加载中...</span>
            </div>
          )}

          {!loading && isReadOnly && (
            <div className="sd-readonly">
              <p className="sd-readonly-text">默认助手无法编辑配置</p>
            </div>
          )}

          {!loading && form && !isReadOnly && (
            <>
              <section className="sd-section">
                <h4 className="sd-section-title">基本信息</h4>
                <div className="sd-field">
                  <label className="sd-label">显示名称</label>
                  <input
                    className="sd-input"
                    value={form.displayName}
                    onChange={(e) => setField("displayName", e.target.value)}
                  />
                </div>
                <div className="sd-field">
                  <label className="sd-label">描述</label>
                  <input
                    className="sd-input"
                    value={form.description}
                    onChange={(e) => setField("description", e.target.value)}
                  />
                </div>
                <div className="sd-field">
                  <label className="sd-label">图标</label>
                  <select
                    className="sd-input"
                    value={form.icon}
                    onChange={(e) => setField("icon", e.target.value)}
                  >
                    {ICON_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
                <div className="sd-field">
                  <label className="sd-label">模型</label>
                  <select
                    className="sd-input"
                    value={form.model}
                    onChange={(e) => setField("model", e.target.value)}
                  >
                    {MODEL_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                    {!MODEL_OPTIONS.some((opt) => opt.value === form.model) && (
                      <option value={form.model}>{form.model}</option>
                    )}
                  </select>
                </div>
              </section>

              <section className="sd-section">
                <h4 className="sd-section-title">人设文件</h4>

                {activeFileKeys.map((key) => {
                  const meta = KNOWN_FILES.find((f) => f.key === key);
                  const isExpanded = expandedFiles.has(key);
                  return (
                    <div key={key} className="sd-file-block">
                      <div className="sd-file-header">
                        <button
                          className="sd-file-toggle"
                          onClick={() => toggleFileSection(key)}
                          type="button"
                        >
                          {isExpanded ? "▾" : "▸"} {meta?.label ?? key}
                        </button>
                        <button
                          className="sd-file-remove"
                          onClick={() => removeFile(key)}
                          title="移除"
                          type="button"
                        >
                          <X size={12} />
                        </button>
                      </div>
                      {isExpanded && (
                        <textarea
                          className="sd-textarea"
                          rows={6}
                          value={form.files[key] ?? ""}
                          onChange={(e) => setFile(key, e.target.value)}
                        />
                      )}
                    </div>
                  );
                })}

                {addableFiles.length > 0 && (
                  <select
                    className="sd-input"
                    value=""
                    onChange={(e) => { if (e.target.value) addFile(e.target.value); }}
                  >
                    <option value="">＋ 添加文件...</option>
                    {addableFiles.map((f) => (
                      <option key={f.key} value={f.key}>{f.label}</option>
                    ))}
                  </select>
                )}
              </section>

              <div className="sd-footer">
                <button
                  className="sd-save-btn"
                  disabled={saving}
                  onClick={() => void handleSave()}
                >
                  {saving ? <Loader size={14} className="spin-icon" /> : <Save size={14} />}
                  <span>{saving ? "保存中..." : "保存"}</span>
                </button>
              </div>
            </>
          )}
        </div>
      </aside>
    </>
  );
}
