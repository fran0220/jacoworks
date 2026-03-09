import { useState, useEffect, useCallback } from "react";
import { Box, RefreshCw, CheckCircle, AlertCircle, Loader } from "lucide-react";
import { getContainerStatus, type ContainerStatus } from "../lib/container";

export default function ContainerPanel() {
  const [status, setStatus] = useState<ContainerStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const s = await getContainerStatus();
      setStatus(s);
      setError(null);
    } catch {
      setError("无法获取容器状态");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchStatus();
  }, [fetchStatus]);

  if (loading) {
    return (
      <div className="panel-container">
        <div className="panel-loading">
          <Loader size={20} className="spin-icon" />
          <span>加载中...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="panel-container">
      <div className="panel-header">
        <Box size={16} />
        <h3>AI 容器</h3>
        <button className="panel-refresh-btn" onClick={fetchStatus} title="刷新">
          <RefreshCw size={14} />
        </button>
      </div>

      <div className="container-card">
        <div className="container-status-row">
          <span className="container-label">状态</span>
          {status?.provisioned ? (
            <span className="container-badge container-badge--active">
              <CheckCircle size={12} />
              运行中
            </span>
          ) : (
            <span className="container-badge container-badge--inactive">
              <AlertCircle size={12} />
              未启动
            </span>
          )}
        </div>

        {status?.provisioned && (
          <div className="container-info-row">
            <span className="container-label">容器</span>
            <span className="container-value">{status.container_name}</span>
          </div>
        )}
      </div>

      {error && <div className="panel-error">{error}</div>}
    </div>
  );
}
