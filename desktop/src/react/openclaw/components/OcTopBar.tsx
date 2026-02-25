import { ArrowLeft, Cloud, PlugZap } from "lucide-react";

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
        <button type="button" className="oc-topbar-back" onClick={onBack}>
          <ArrowLeft size={14} />
          返回本地模式
        </button>
      </div>

      <div className="oc-topbar-right">
        <span className={`oc-connection-badge ${status === "ready" ? "ready" : "connecting"}`}>
          {status === "ready" ? <PlugZap size={12} /> : <Cloud size={12} />}
          {status === "ready" ? "已连接" : "连接中"}
        </span>
        {containerName && <span className="oc-container-badge">{containerName}</span>}
      </div>
    </header>
  );
}
