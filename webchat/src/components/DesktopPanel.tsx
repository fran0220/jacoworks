import { useState } from "react";
import { Monitor, Maximize2, Minimize2, ExternalLink } from "lucide-react";
import { getOpenClawVncUrl } from "../lib/config";

export default function DesktopPanel() {
  const vncUrl = getOpenClawVncUrl();
  const [fullscreen, setFullscreen] = useState(false);

  if (!vncUrl) {
    return (
      <div className="desktop-panel-empty">
        <Monitor size={48} strokeWidth={1.2} />
        <h3>远程桌面未配置</h3>
        <p>当前容器未启用桌面环境。联系管理员开通桌面 VM。</p>
      </div>
    );
  }

  // Build the full noVNC URL with auto-connect params
  const noVncSrc = vncUrl.includes("?")
    ? `${vncUrl}&autoconnect=true&resize=scale`
    : `${vncUrl}?autoconnect=true&resize=scale`;

  return (
    <div className={`desktop-panel${fullscreen ? " desktop-panel-fullscreen" : ""}`}>
      <div className="desktop-panel-toolbar">
        <div className="desktop-panel-title">
          <Monitor size={16} />
          <span>远程桌面</span>
        </div>
        <div className="desktop-panel-actions">
          <a
            href={noVncSrc}
            target="_blank"
            rel="noopener noreferrer"
            className="desktop-panel-btn"
            title="在新窗口打开"
          >
            <ExternalLink size={14} />
          </a>
          <button
            className="desktop-panel-btn"
            onClick={() => setFullscreen(!fullscreen)}
            title={fullscreen ? "退出全屏" : "全屏"}
          >
            {fullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
        </div>
      </div>
      <iframe
        className="desktop-panel-frame"
        src={noVncSrc}
        allow="clipboard-read; clipboard-write"
      />
    </div>
  );
}
