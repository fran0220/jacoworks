import { FolderOpen, HardDrive, Info, RefreshCw, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { selectFolder } from "../lib/cowork";
import { getSettings, updateSettings } from "../lib/config";

interface MemoryStats {
  path: string;
  file_count: number;
  total_bytes: number;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function SettingsModal({ onClose }: { onClose: () => void }) {
  const [settings, setSettings] = useState(getSettings);
  const [memoryStats, setMemoryStats] = useState<MemoryStats | null>(null);
  const [version, setVersion] = useState("0.1.0");
  const [updateStatus, setUpdateStatus] = useState<
    "idle" | "checking" | "latest" | "available" | "error"
  >("idle");
  const [clearing, setClearing] = useState(false);
  const [restartHint, setRestartHint] = useState(false);

  useEffect(() => {
    if (isTauri()) {
      getVersion().then(setVersion).catch(() => {});
      invoke<MemoryStats>("get_memory_stats")
        .then(setMemoryStats)
        .catch(() => {});
    }
  }, []);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [onClose]);

  const toggleMemory = () => {
    const next = !settings.memoryEnabled;
    const updated = { ...settings, memoryEnabled: next };
    updateSettings(updated);
    setSettings(updated);
    setRestartHint(true);
  };

  const handleSelectWorkspace = async () => {
    const selected = await selectFolder();
    if (selected) {
      const updated = { ...settings, defaultWorkspace: selected };
      updateSettings(updated);
      setSettings(updated);
    }
  };

  const handleClearWorkspace = () => {
    const updated = { ...settings, defaultWorkspace: "" };
    updateSettings(updated);
    setSettings(updated);
  };

  const handleClearMemory = async () => {
    if (!window.confirm("确认清除所有记忆数据？此操作不可恢复。")) return;
    setClearing(true);
    try {
      await invoke("clear_memory");
      const stats = await invoke<MemoryStats>("get_memory_stats");
      setMemoryStats(stats);
    } catch {
      // ignore
    } finally {
      setClearing(false);
    }
  };

  const handleCheckUpdate = async () => {
    setUpdateStatus("checking");
    try {
      const res = await fetch(
        "https://api.github.com/repos/fran0220/jacoworks/releases/latest",
      );
      if (!res.ok) throw new Error("fetch failed");
      const data = await res.json();
      const latest = (data.tag_name || "").replace(/^v/, "");
      if (latest && latest !== version) {
        setUpdateStatus("available");
        if (isTauri()) {
          await openUrl(data.html_url);
        }
      } else {
        setUpdateStatus("latest");
      }
    } catch {
      // Private repo or network error — open releases page directly
      setUpdateStatus("error");
    }
  };

  const handleOpenReleases = async () => {
    if (isTauri()) {
      await openUrl("https://github.com/fran0220/jacoworks/releases");
    }
  };

  return (
    <div className="settings-backdrop" onClick={onClose}>
      <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <h2>设置</h2>
          <button className="settings-close" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="settings-body">
          {/* ── Agent Section ── */}
          <div className="settings-section">
            <div className="settings-section-title">Agent</div>

            {/* Memory toggle */}
            <div className="settings-item">
              <div className="settings-item-main">
                <div className="settings-item-info">
                  <HardDrive size={16} />
                  <div>
                    <div className="settings-item-label">记忆系统</div>
                    <div className="settings-item-desc">
                      自动记录对话摘要，为 Agent 提供上下文记忆
                    </div>
                  </div>
                </div>
                <button
                  className={`toggle ${settings.memoryEnabled ? "on" : ""}`}
                  onClick={toggleMemory}
                >
                  <span className="toggle-thumb" />
                </button>
              </div>

              {memoryStats && (
                <div className="settings-memory-meta">
                  <span className="settings-meta-path" title={memoryStats.path}>
                    {memoryStats.path}
                  </span>
                  <span className="settings-meta-size">
                    {memoryStats.file_count} 个文件 · {formatBytes(memoryStats.total_bytes)}
                  </span>
                </div>
              )}

              <button
                className="settings-btn-danger"
                onClick={handleClearMemory}
                disabled={clearing}
              >
                <Trash2 size={13} />
                {clearing ? "清除中..." : "清除所有记忆"}
              </button>

              {restartHint && (
                <div className="settings-hint">重启 Agent 后生效</div>
              )}
            </div>

            {/* Default workspace */}
            <div className="settings-item">
              <div className="settings-item-main">
                <div className="settings-item-info">
                  <FolderOpen size={16} />
                  <div>
                    <div className="settings-item-label">默认工作目录</div>
                    <div className="settings-item-desc">
                      新会话自动使用此目录作为工作区
                    </div>
                  </div>
                </div>
                <button className="settings-btn-outline" onClick={handleSelectWorkspace}>
                  选择文件夹
                </button>
              </div>

              {settings.defaultWorkspace && (
                <div className="settings-workspace-path">
                  <FolderOpen size={13} />
                  <span title={settings.defaultWorkspace}>
                    {settings.defaultWorkspace}
                  </span>
                  <button className="settings-btn-clear" onClick={handleClearWorkspace}>
                    <X size={12} />
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* ── About Section ── */}
          <div className="settings-section">
            <div className="settings-section-title">关于</div>

            <div className="settings-item">
              <div className="settings-item-main">
                <div className="settings-item-info">
                  <Info size={16} />
                  <div>
                    <div className="settings-item-label">JAcoworks</div>
                    <div className="settings-item-desc">v{version}</div>
                  </div>
                </div>
                <button
                  className="settings-btn-outline"
                  onClick={handleCheckUpdate}
                  disabled={updateStatus === "checking"}
                >
                  <RefreshCw
                    size={13}
                    className={updateStatus === "checking" ? "spinning" : ""}
                  />
                  检查更新
                </button>
              </div>

              {updateStatus === "latest" && (
                <div className="settings-hint success">✓ 当前已是最新版本</div>
              )}
              {updateStatus === "available" && (
                <div className="settings-hint success">发现新版本，已打开下载页面</div>
              )}
              {updateStatus === "error" && (
                <div className="settings-hint">
                  无法自动检查 ·{" "}
                  <button className="settings-link" onClick={handleOpenReleases}>
                    前往 GitHub Releases
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
