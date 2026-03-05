import { LoaderCircle, Server, X } from "lucide-react";

export default function Provision({
  phase,
  message,
  detail,
  onClose,
}: {
  phase: "checking" | "provisioning" | "connecting";
  message: string;
  detail?: string;
  onClose?: () => void;
}) {
  return (
    <div className="oc-provision">
      {onClose && (
        <button type="button" className="oc-drawer-close oc-provision-close" onClick={onClose} title="关闭协作">
          <X size={14} />
        </button>
      )}
      <div className="oc-provision-card">
        <div className="oc-provision-icon-wrap">
          <Server size={16} />
          {phase !== "checking" && <LoaderCircle size={14} className="oc-spinning" />}
        </div>
        <h2 className="oc-provision-title">协作环境准备中</h2>
        <p className="oc-provision-message">{message}</p>
        {detail && <p className="oc-provision-detail">{detail}</p>}
      </div>
    </div>
  );
}
