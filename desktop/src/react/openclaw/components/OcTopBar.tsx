import { Cloud, PlugZap, X } from "lucide-react";

export default function OcTopBar({
  status,
  containerName,
  onBack,
}: {
  status: "connecting" | "ready";
  containerName: string;
  onBack: () => void;
}) {
  return (
    <header className="oc-topbar">
      <div className="oc-topbar-left">
        <span className={`oc-connection-badge ${status === "ready" ? "ready" : "connecting"}`}>
          {status === "ready" ? <PlugZap size={12} /> : <Cloud size={12} />}
          {status === "ready" ? "已连接" : "连接中"}
        </span>
        {containerName && <span className="oc-container-badge">{containerName}</span>}
      </div>

      <div className="oc-topbar-right">
        <button type="button" className="oc-topbar-close" onClick={onBack} title="关闭 OpenClaw">
          <X size={14} />
        </button>
      </div>
    </header>
  );
}
