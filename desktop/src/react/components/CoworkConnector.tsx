import { Activity, AlertTriangle, CheckCircle, Cloud, LoaderCircle, MessageSquare, PlugZap } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import type { OcConnectionPhase } from "../hooks/use-cowork-connection";
import { useClickOutside } from "../hooks/use-click-outside";
import { checkContainerStatus } from "../cowork/lib/api";

type StatusPhase = "idle" | "checking" | "ready" | "error";

function phaseLabel(phase: OcConnectionPhase): string {
  switch (phase) {
    case "idle": return "未连接";
    case "checking": return "正在检查...";
    case "provisioning": return "正在分配容器...";
    case "connecting": return "正在连接...";
    case "ready": return "已连接";
    case "reconnecting": return "重连中...";
    case "error": return "连接失败";
  }
}

function PhaseIcon({ phase }: { phase: OcConnectionPhase }) {
  switch (phase) {
    case "ready": return <PlugZap size={12} />;
    case "checking":
    case "provisioning":
    case "connecting":
    case "reconnecting":
      return <LoaderCircle size={12} className="spinning" />;
    case "error": return <AlertTriangle size={12} />;
    default: return <Cloud size={12} />;
  }
}

export default function CoworkConnector({
  ocPhase,
  onOpenChat,
  onClose,
}: {
  ocPhase: OcConnectionPhase;
  onOpenChat: () => void;
  onClose: () => void;
}) {
  const [statusPhase, setStatusPhase] = useState<StatusPhase>("idle");
  const [statusText, setStatusText] = useState("");
  const [containerName, setContainerName] = useState("");
  const panelRef = useRef<HTMLDivElement>(null);

  useClickOutside(panelRef, onClose);

  const checkStatus = useCallback(async () => {
    setStatusPhase("checking");
    setStatusText("正在检查...");
    try {
      const status = await checkContainerStatus();
      if (status.container_name) setContainerName(status.container_name);
      if (status.provisioned) {
        setStatusPhase("ready");
        setStatusText("容器运行中");
      } else {
        setStatusPhase("error");
        setStatusText("容器未就绪");
      }
    } catch {
      setStatusPhase("error");
      setStatusText("无法获取状态");
    }
  }, []);

  // Show SSE connection phase when actively connecting
  const showLivePhase = ocPhase !== "idle";

  return (
    <div className="oc-connector" ref={panelRef}>
      <div className="oc-connector-header">
        <Cloud size={14} />
        <span>协作</span>
        {showLivePhase && (
          <span className={`oc-connector-phase ${ocPhase}`}>
            <PhaseIcon phase={ocPhase} />
            {phaseLabel(ocPhase)}
          </span>
        )}
      </div>

      {statusPhase !== "idle" && !showLivePhase && (
        <div className="oc-connector-status-bar">
          {statusPhase === "checking" && <LoaderCircle size={12} className="spinning" />}
          {statusPhase === "ready" && <CheckCircle size={12} />}
          {statusPhase === "error" && <AlertTriangle size={12} />}
          <span>{statusText}</span>
          {containerName && statusPhase === "ready" && (
            <span className="oc-connector-container">{containerName}</span>
          )}
        </div>
      )}

      <div className="oc-connector-buttons">
        <button
          type="button"
          className="oc-connector-btn"
          onClick={checkStatus}
          disabled={statusPhase === "checking"}
        >
          <Activity size={14} />
          状态
        </button>
        <button
          type="button"
          className="oc-connector-btn primary"
          onClick={onOpenChat}
        >
          <MessageSquare size={14} />
          对话
        </button>
      </div>
    </div>
  );
}
