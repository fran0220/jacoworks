import { useCallback, useEffect, useRef, useState } from "react";
import { Bot, Loader } from "lucide-react";
import { getContainerStatus, provisionContainer } from "../lib/container";

type GateStage = "checking" | "provisioning" | "polling" | "ready" | "error";

interface SetupGateProps {
  onReady: (token: string) => void;
  /** When set, container is ready but WS is still connecting. */
  wsState?: "disconnected" | "connecting" | "connected";
}

export default function SetupGate({ onReady, wsState }: SetupGateProps) {
  const [stage, setStage] = useState<GateStage>("checking");
  const [error, setError] = useState<string | null>(null);
  const pollTimer = useRef<number | null>(null);
  const readyFired = useRef(false);

  const stopPolling = useCallback(() => {
    if (pollTimer.current !== null) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
  }, []);

  const finishSetup = useCallback(
    (token: string) => {
      if (readyFired.current) return;
      readyFired.current = true;
      setStage("ready");
      stopPolling();
      onReady(token);
    },
    [stopPolling, onReady],
  );

  /** Container is truly online when provisioned + ready + has token */
  const isOnline = (s: { provisioned: boolean; ready?: boolean; container_token?: string }) =>
    s.provisioned && s.ready !== false && !!s.container_token;

  const startPolling = useCallback(() => {
    setStage("polling");
    stopPolling();
    pollTimer.current = window.setInterval(() => {
      getContainerStatus()
        .then((status) => {
          if (isOnline(status)) {
            finishSetup(status.container_token!);
          }
        })
        .catch(() => {
          // Ignore poll errors and keep waiting.
        });
    }, 3000);
  }, [finishSetup, stopPolling]);

  const runSetup = useCallback(async () => {
    setError(null);
    setStage("checking");
    readyFired.current = false;

    try {
      const status = await getContainerStatus();
      if (isOnline(status)) {
        finishSetup(status.container_token!);
        return;
      }
    } catch {
      // Continue to provisioning even if status check fails.
    }

    // Not ready (or no container) — provision will create or wake the container
    try {
      setStage("provisioning");
      const result = await provisionContainer();
      if (result.status === "ready" && result.container_token) {
        try {
          const status = await getContainerStatus();
          if (isOnline(status)) {
            finishSetup(status.container_token!);
            return;
          }
        } catch {
          // Fall through to polling
        }
      }
      startPolling();
    } catch {
      setStage("error");
      setError("初始化失败，请检查网络后重试");
      stopPolling();
    }
  }, [finishSetup, startPolling, stopPolling]);

  // Only run setup when we don't already have a token (wsState is undefined)
  useEffect(() => {
    if (wsState !== undefined) return; // Token already set, just waiting for WS
    runSetup();
    return stopPolling;
  }, [runSetup, stopPolling, wsState]);

  // Determine status text — WS connecting phase takes priority when active
  let statusText: string;
  if (wsState !== undefined) {
    // Phase 2: container ready, WS connecting
    statusText =
      wsState === "connecting"
        ? "正在连接 AI 工作区..."
        : "正在建立连接..."; // disconnected, waiting for WS effect to kick in
  } else {
    statusText =
      stage === "checking"
        ? "检查容器状态..."
        : stage === "provisioning"
          ? "正在申请 AI 容器..."
          : stage === "polling"
            ? "容器启动中，正在等待就绪..."
            : stage === "ready"
              ? "容器已就绪，正在连接..."
              : "初始化遇到问题";
  }

  const showError = !wsState && stage === "error";

  return (
    <div className="setup-gate">
      <div className="setup-gate-card">
        <div className="setup-gate-icon-wrap">
          <Bot size={24} />
        </div>
        <h1>正在初始化 AI 工作区...</h1>
        <p className="setup-gate-subtitle">首次进入需要准备 OpenClaw 容器，通常在 10-30 秒内完成。</p>

        <div className="setup-gate-status">
          <Loader size={16} className="spin-icon" />
          <span>{statusText}</span>
        </div>

        {error && showError && <div className="panel-error">{error}</div>}

        {showError && (
          <button className="setup-gate-retry" onClick={runSetup}>
            重新初始化
          </button>
        )}
      </div>
    </div>
  );
}
