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

  const finishSetup = useCallback((token?: string) => {
    setStage("ready");
    stopPolling();

    // Inject token directly to avoid reload loop when server-side injection fails
    if (token) {
      window.__OPENCLAW_TOKEN__ = token;
    }

    window.setTimeout(() => {
      if (token) {
        // Token available — re-render the app by dispatching a state change
        window.dispatchEvent(new Event("openclaw-token-ready"));
      } else {
        // Fallback: reload once, but guard against infinite loop
        const key = "jacoworks.setup.reloads";
        const count = parseInt(sessionStorage.getItem(key) || "0", 10);
        if (count < 2) {
          sessionStorage.setItem(key, String(count + 1));
          location.reload();
        } else {
          sessionStorage.removeItem(key);
          setStage("error");
          setError("容器已就绪但无法获取访问令牌，请刷新页面重试");
        }
      }
    }, 300);
  }, [stopPolling]);

  const startPolling = useCallback(() => {
    setStage("polling");
    stopPolling();
    pollTimer.current = window.setInterval(() => {
      getContainerStatus()
        .then((status) => {
          if (status.provisioned && status.container_token) {
            finishSetup(status.container_token);
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
      if (status.provisioned && status.container_token) {
        finishSetup(status.container_token);
        return;
      }
    } catch {
      // Continue to provisioning even if status check fails.
    }

    try {
      setStage("provisioning");
      const result = await provisionContainer();
      if (result.status === "ready" && result.container_token) {
        finishSetup(result.container_token);
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
