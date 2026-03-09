import { useCallback, useEffect, useRef, useState } from "react";
import { Bot, Loader } from "lucide-react";
import { getContainerStatus, provisionContainer } from "../lib/container";

type GateStage = "checking" | "provisioning" | "polling" | "ready" | "error";

export default function SetupGate() {
  const [stage, setStage] = useState<GateStage>("checking");
  const [error, setError] = useState<string | null>(null);
  const pollTimer = useRef<number | null>(null);

  const stopPolling = useCallback(() => {
    if (pollTimer.current !== null) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
  }, []);

  const finishSetup = useCallback(() => {
    setStage("ready");
    stopPolling();
    window.setTimeout(() => {
      location.reload();
    }, 300);
  }, [stopPolling]);

  const startPolling = useCallback(() => {
    setStage("polling");
    stopPolling();
    pollTimer.current = window.setInterval(() => {
      getContainerStatus()
        .then((status) => {
          if (status.provisioned) {
            finishSetup();
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

    try {
      const status = await getContainerStatus();
      if (status.provisioned) {
        finishSetup();
        return;
      }
    } catch {
      // Continue to provisioning even if status check fails.
    }

    try {
      setStage("provisioning");
      const result = await provisionContainer();
      if (result.status === "ready") {
        finishSetup();
        return;
      }
      startPolling();
    } catch {
      setStage("error");
      setError("初始化失败，请检查网络后重试");
      stopPolling();
    }
  }, [finishSetup, startPolling, stopPolling]);

  useEffect(() => {
    runSetup();
    return stopPolling;
  }, [runSetup, stopPolling]);

  const statusText =
    stage === "checking"
      ? "检查容器状态..."
      : stage === "provisioning"
        ? "正在申请 AI 容器..."
        : stage === "polling"
          ? "容器启动中，正在等待就绪..."
          : stage === "ready"
            ? "工作区已就绪，正在进入..."
            : "初始化遇到问题";

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

        {error && <div className="panel-error">{error}</div>}

        {stage === "error" && (
          <button className="setup-gate-retry" onClick={runSetup}>
            重新初始化
          </button>
        )}
      </div>
    </div>
  );
}
