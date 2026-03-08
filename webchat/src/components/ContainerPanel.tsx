import { useState, useEffect, useRef, useCallback } from "react";
import { Box, RefreshCw, CheckCircle, AlertCircle, Loader } from "lucide-react";
import { getContainerStatus, provisionContainer, type ContainerStatus } from "../lib/container";

export default function ContainerPanel() {
  const [status, setStatus] = useState<ContainerStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [provisioning, setProvisioning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollTimer = useRef<number | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const s = await getContainerStatus();
      setStatus(s);
      setError(null);
      if (s.provisioned) {
        setProvisioning(false);
        stopPolling();
      }
    } catch {
      setError("无法获取容器状态");
    } finally {
      setLoading(false);
    }
  }, []);

  const stopPolling = useCallback(() => {
    if (pollTimer.current !== null) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    return stopPolling;
  }, [fetchStatus, stopPolling]);

  const handleProvision = async () => {
    setProvisioning(true);
    setError(null);
    try {
      const result = await provisionContainer();
      if (result.status === "ready") {
        await fetchStatus();
      } else {
        // Poll until container is ready, then reload page to inject new OPENCLAW_TOKEN
        pollTimer.current = window.setInterval(async () => {
          const s = await getContainerStatus();
          if (s.provisioned) {
            stopPolling();
            setProvisioning(false);
            // Reload page so Website re-injects __OPENCLAW_TOKEN__ with the new container_token
            location.reload();
          }
        }, 3000);
      }
    } catch {
      setError("容器启动失败");
      setProvisioning(false);
    }
  };

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
          ) : provisioning ? (
            <span className="container-badge container-badge--pending">
              <Loader size={12} className="spin-icon" />
              启动中...
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

        {!status?.provisioned && !provisioning && (
          <button className="container-provision-btn" onClick={handleProvision}>
            启动 AI 容器
          </button>
        )}
      </div>

      {error && <div className="panel-error">{error}</div>}
    </div>
  );
}
