import { LoaderCircle, Server } from "lucide-react";

export default function Provision({
  phase,
  message,
  detail,
}: {
  phase: "checking" | "provisioning" | "connecting";
  message: string;
  detail?: string;
}) {
  return (
    <div className="oc-provision">
      <div className="oc-provision-card">
        <div className="oc-provision-icon-wrap">
          <Server size={16} />
          {phase !== "checking" && <LoaderCircle size={14} className="oc-spinning" />}
        </div>
        <h2 className="oc-provision-title">OpenClaw 准备中</h2>
        <p className="oc-provision-message">{message}</p>
        {detail && <p className="oc-provision-detail">{detail}</p>}
      </div>
    </div>
  );
}
