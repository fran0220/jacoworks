import { useEffect, useMemo, useState } from "react";
import { Monitor, Maximize2, Minimize2, ExternalLink } from "lucide-react";
import { getPiVMVncUrl } from "../lib/config";
import { openExternalUrl } from "../lib/external-open";
import { shouldUseExternalDesktop } from "../lib/platform";

function buildNoVncUrl(vncUrl: string): string {
  return vncUrl.includes("?")
    ? `${vncUrl}&autoconnect=true&resize=scale`
    : `${vncUrl}?autoconnect=true&resize=scale`;
}

export default function DesktopPanel() {
  const vncUrl = getPiVMVncUrl();
  const [fullscreen, setFullscreen] = useState(false);
  const [preferExternal, setPreferExternal] = useState(() => shouldUseExternalDesktop());

  useEffect(() => {
    if (typeof window === "undefined") return;

    const media = typeof window.matchMedia === "function" ? window.matchMedia("(max-width: 768px)") : null;
    const update = () => setPreferExternal(shouldUseExternalDesktop());

    update();

    if (!media) return;

    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", update);
      return () => media.removeEventListener("change", update);
    }

    media.addListener(update);
    return () => media.removeListener(update);
  }, []);

  const noVncSrc = useMemo(() => (vncUrl ? buildNoVncUrl(vncUrl) : ""), [vncUrl]);

  if (!vncUrl) {
    return (
      <div className="desktop-panel-empty">
        <Monitor size={48} strokeWidth={1.2} />
        <h3>远程桌面未配置</h3>
        <p>当前容器还没有可用的桌面 VM。联系管理员开通后，这里会显示 Beta 入口。</p>
      </div>
    );
  }

  if (preferExternal) {
    return (
      <div className="desktop-panel desktop-panel-beta">
        <div className="desktop-panel-toolbar">
          <div className="desktop-panel-title">
            <Monitor size={16} />
            <span>远程桌面 Beta</span>
          </div>
        </div>
        <div className="desktop-panel-beta-card">
          <h3>移动端默认外跳浏览器</h3>
          <p>Beta 阶段优先在系统浏览器中打开 noVNC，避免移动 WebView 中出现输入、触控和全屏兼容问题。</p>
          <button
            type="button"
            className="desktop-panel-launch-btn"
            onClick={() => void openExternalUrl(noVncSrc)}
          >
            <ExternalLink size={16} />
            在浏览器中打开
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`desktop-panel${fullscreen ? " desktop-panel-fullscreen" : ""}`}>
      <div className="desktop-panel-toolbar">
        <div className="desktop-panel-title">
          <Monitor size={16} />
          <span>远程桌面 Beta</span>
        </div>
        <div className="desktop-panel-actions">
          <button
            type="button"
            className="desktop-panel-btn"
            title="在新窗口打开"
            onClick={() => void openExternalUrl(noVncSrc)}
          >
            <ExternalLink size={14} />
          </button>
          <button
            type="button"
            className="desktop-panel-btn"
            onClick={() => setFullscreen((value) => !value)}
            title={fullscreen ? "退出全屏" : "全屏"}
          >
            {fullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
        </div>
      </div>
      <iframe
        className="desktop-panel-frame"
        src={noVncSrc}
        title="远程桌面"
        allow="clipboard-read; clipboard-write"
      />
    </div>
  );
}
