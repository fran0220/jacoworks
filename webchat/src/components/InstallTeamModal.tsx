import { useState } from "react";
import { Loader, Users, X } from "lucide-react";
import { installTeam, type TeamTemplate } from "../lib/teams";

interface InstallTeamModalProps {
  open: boolean;
  onClose: () => void;
  onInstalled: () => void;
  available: TeamTemplate[];
  installed: string;
}

export default function InstallTeamModal({ open, onClose, onInstalled, available, installed }: InstallTeamModalProps) {
  const [installing, setInstalling] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const installable = available.filter((t) => t.name !== installed);

  const handleInstall = async (name: string) => {
    setInstalling(name);
    setError(null);
    try {
      await installTeam(name);
      onInstalled();
      onClose();
    } catch {
      setError("安装失败，请重试");
    } finally {
      setInstalling(null);
    }
  };

  return (
    <>
      <div className="cam-backdrop" onClick={onClose} />
      <div className="cam-modal">
        <header className="cam-header">
          <strong>安装团队模板</strong>
          <button className="cam-close" onClick={onClose}><X size={16} /></button>
        </header>
        <div className="cam-body">
          {installable.length === 0 && (
            <p className="itm-empty">暂无可安装的团队模板</p>
          )}
          {installable.map((t) => (
            <div key={t.name} className="itm-card">
              <div className="itm-card-head">
                <Users size={16} />
                <strong>{t.displayName}</strong>
                <span className="itm-version">v{t.version}</span>
              </div>
              <p className="itm-desc">{t.description || "安装后可在对话中切换到该团队。"}</p>
              <div className="itm-meta">{t.agents.length} 个角色：{t.agents.map((a) => a.name).join("、")}</div>
              <button
                className="cam-submit itm-install-btn"
                disabled={installing !== null}
                onClick={() => void handleInstall(t.name)}
              >
                {installing === t.name ? <><Loader size={14} className="spin-icon" /><span>安装中...</span></> : <span>安装</span>}
              </button>
            </div>
          ))}
          {error && <div className="cam-error">{error}</div>}
        </div>
        <footer className="cam-footer">
          <button className="cam-cancel" onClick={onClose}>关闭</button>
        </footer>
      </div>
    </>
  );
}
