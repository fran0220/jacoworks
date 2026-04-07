import { useEffect, useMemo, useState } from "react";
import { Loader, Save, X } from "lucide-react";
import type { ProfileDetail } from "../../lib/teams";
import AvatarPicker from "../AvatarPicker";
import { ICON_OPTIONS, KNOWN_FILES } from "./constants";

interface ProfileEditorProps {
  detail: ProfileDetail;
  isCreate: boolean;
  saving: boolean;
  onSave: (detail: ProfileDetail) => void;
  onCancel: () => void;
}

export default function ProfileEditor({
  detail,
  isCreate,
  saving,
  onSave,
  onCancel,
}: ProfileEditorProps) {
  const [form, setForm] = useState<ProfileDetail>({
    ...detail,
    files: { ...detail.files },
  });
  const [filesOpen, setFilesOpen] = useState(false);

  useEffect(() => {
    setForm({
      ...detail,
      files: { ...detail.files },
    });
  }, [detail]);

  const activeFileKeys = useMemo(
    () => KNOWN_FILES.filter((fileMeta) => fileMeta.key in form.files).map((fileMeta) => fileMeta.key),
    [form.files],
  );

  const addableFiles = useMemo(
    () => KNOWN_FILES.filter((fileMeta) => !(fileMeta.key in form.files)),
    [form.files],
  );

  const setField = <K extends keyof ProfileDetail>(key: K, value: ProfileDetail[K]) =>
    setForm((previous) => ({ ...previous, [key]: value }));

  const setFile = (key: string, value: string) =>
    setForm((previous) => ({ ...previous, files: { ...previous.files, [key]: value } }));

  const removeFile = (key: string) =>
    setForm((previous) => {
      const nextFiles = { ...previous.files };
      delete nextFiles[key];
      return { ...previous, files: nextFiles };
    });

  const addFile = (key: string) => {
    setFile(key, "");
    setFilesOpen(true);
  };

  return (
    <div className="team-editor">
      <div className="team-editor-field">
        <label className="team-editor-label">name</label>
        <input
          className="team-editor-input"
          value={form.name}
          disabled={!isCreate}
          placeholder="英文标识 (如 writer)"
          onChange={(event) => setField("name", event.target.value)}
        />
      </div>

      <div className="team-editor-field">
        <label className="team-editor-label">displayName</label>
        <input
          className="team-editor-input"
          value={form.displayName}
          placeholder="显示名称"
          onChange={(event) => setField("displayName", event.target.value)}
        />
      </div>

      <div className="team-editor-field">
        <label className="team-editor-label">description</label>
        <input
          className="team-editor-input"
          value={form.description}
          placeholder="简短描述"
          onChange={(event) => setField("description", event.target.value)}
        />
      </div>

      <div className="team-editor-field">
        <label className="team-editor-label">icon</label>
        <select
          className="team-editor-input"
          value={form.icon}
          onChange={(event) => setField("icon", event.target.value)}
        >
          {ICON_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <div className="team-editor-field">
        <label className="team-editor-label">model</label>
        <input
          className="team-editor-input"
          value={form.model}
          placeholder="proxy/gpt-5.4"
          onChange={(event) => setField("model", event.target.value)}
        />
      </div>

      <div className="team-editor-field">
        <label className="team-editor-label">avatar</label>
        <AvatarPicker
          value={form.spritePackId}
          onChange={(nextId) => setField("spritePackId", nextId)}
        />
      </div>

      <div className="team-editor-files">
        <button
          className="team-editor-files-toggle"
          onClick={() => setFilesOpen((open) => !open)}
          type="button"
        >
          {filesOpen ? "▾" : "▸"} 人设文件 ({activeFileKeys.length})
        </button>

        {filesOpen && (
          <>
            {activeFileKeys.map((key) => {
              const fileMeta = KNOWN_FILES.find((knownFile) => knownFile.key === key);
              return (
                <div key={key} className="team-editor-field">
                  <div className="team-editor-file-header">
                    <label className="team-editor-label">{fileMeta?.label ?? key}</label>
                    <button
                      className="team-editor-file-remove"
                      onClick={() => removeFile(key)}
                      title="移除"
                      type="button"
                    >
                      <X size={12} />
                    </button>
                  </div>
                  <textarea
                    className="team-editor-textarea"
                    rows={5}
                    value={form.files[key] ?? ""}
                    onChange={(event) => setFile(key, event.target.value)}
                  />
                </div>
              );
            })}

            {addableFiles.length > 0 && (
              <div className="team-editor-field">
                <select
                  className="team-editor-input"
                  value=""
                  onChange={(event) => {
                    if (event.target.value) addFile(event.target.value);
                  }}
                >
                  <option value="">＋ 添加文件...</option>
                  {addableFiles.map((fileMeta) => (
                    <option key={fileMeta.key} value={fileMeta.key}>
                      {fileMeta.label}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </>
        )}
      </div>

      <div className="team-editor-actions">
        <button
          className="team-action-btn"
          disabled={saving || !form.name.trim()}
          onClick={() => onSave(form)}
        >
          {saving ? <Loader size={14} className="spin-icon" /> : <Save size={14} />}
          <span>{saving ? "保存中..." : "保存"}</span>
        </button>
        <button className="team-install-btn" onClick={onCancel} disabled={saving}>
          <X size={14} />
          <span>取消</span>
        </button>
      </div>
    </div>
  );
}
