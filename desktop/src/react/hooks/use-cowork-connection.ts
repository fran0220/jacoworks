import { useCallback, useEffect, useRef, useState } from "react";
import { checkContainerStatus, provisionContainer, type ContainerStatus } from "../cowork/lib/api";
import { CloudAgentWS } from "../lib/cloud-agent-ws";
import { handleFileRequest } from "../lib/cloud-file-handler";
import type { AgentRpcEvent } from "../lib/agent";
import type { CronResultItem } from "./use-cron-results";

const MAX_CRON_RESULTS = 50;

export type OcConnectionPhase =
  | "idle"
  | "checking"
  | "provisioning"
  | "connecting"
  | "ready"
  | "reconnecting"
  | "error";

const PROVISION_POLL_MS = 2_000;
const PROVISION_MAX_ATTEMPTS = 60;
const CONNECT_TIMEOUT_MS = 25_000;

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function isContainerReady(status: ContainerStatus): boolean {
  if (typeof status.ready === "boolean") {
    return status.ready;
  }

  // Backward compatibility for older gateway versions that only expose
  // `provisioned`; this can still race, but keeps mixed-version clients usable.
  return status.provisioned;
}

function getContainerState(status: ContainerStatus): string {
  return typeof status.status === "string" ? status.status.toLowerCase() : "";
}

function isWakeupState(state: string): boolean {
  return state === "paused" || state === "stopped" || state === "exited";
}

function shouldShowWakeupHint(reason: string): boolean {
  const lower = reason.toLowerCase();
  return lower.includes("container") || lower.includes("upstream") || lower.includes("连接失败");
}

function isFatalBootstrapError(message: string): boolean {
  return message.includes("未找到登录 token") || message.includes("不支持的网关协议") || message.includes("登录已过期");
}

export function useCoworkConnection(authenticated = false) {
  const [phase, setPhase] = useState<OcConnectionPhase>("idle");
  const [statusText, setStatusText] = useState("");
  const [containerName, setContainerName] = useState("");
  const [errorText, setErrorText] = useState<string | null>(null);
  const [lastActivity, setLastActivity] = useState(0);
  const [reconnectCount, setReconnectCount] = useState(0);
  const [cronResults, setCronResults] = useState<CronResultItem[]>([]);

  const wsRef = useRef<CloudAgentWS | null>(null);
  const phaseRef = useRef<OcConnectionPhase>("idle");
  const cancelTokenRef = useRef(0);
  const messageHandlerRef = useRef<((packet: AgentRpcEvent) => void) | null>(null);
  const workspacePathRef = useRef<string>("");

  const setPhaseSync = useCallback((p: OcConnectionPhase) => {
    phaseRef.current = p;
    setPhase(p);
  }, []);

  const doBootstrap = useCallback(
    async (token: number) => {
      const cancelled = () => cancelTokenRef.current !== token;

      setPhaseSync("checking");
      setStatusText("正在检查容器状态...");
      setErrorText(null);
      setReconnectCount(0);
      setLastActivity(0);

      try {
        const status = await checkContainerStatus();
        if (cancelled()) return;

        if (status.container_name) setContainerName(status.container_name);

        const currentState = getContainerState(status);

        if (!status.provisioned) {
          setPhaseSync("provisioning");
          setStatusText("正在分配协作容器...");
          const provision = await provisionContainer();
          if (cancelled()) return;

          if (provision.container_name) setContainerName(provision.container_name);

          let ready = false;
          for (let i = 0; i < PROVISION_MAX_ATTEMPTS; i++) {
            if (cancelled()) return;
            setStatusText(`容器准备中 (${i + 1}/${PROVISION_MAX_ATTEMPTS})...`);
            await sleep(PROVISION_POLL_MS);

            const polled = await checkContainerStatus();
            if (cancelled()) return;
            if (polled.container_name) setContainerName(polled.container_name);
            if (isContainerReady(polled)) {
              ready = true;
              break;
            }
          }

          if (!ready) throw new Error("容器分配超时，请稍后重试");
        } else if (!isContainerReady(status)) {
          setStatusText(isWakeupState(currentState) ? "正在唤醒容器..." : "容器准备中...");
        }

        if (cancelled()) return;
        setPhaseSync("connecting");
        if (isWakeupState(currentState)) {
          setStatusText("正在唤醒容器...");
        } else if (!isContainerReady(status)) {
          setStatusText("容器准备中...");
        } else {
          setStatusText("正在连接协作环境...");
        }

        // Create WS and wait for ready
        await new Promise<void>((resolve, reject) => {
          if (cancelled()) {
            reject(new Error("cancelled"));
            return;
          }

          let settled = false;
          let firstReady = false;
          let ws: CloudAgentWS | null = null;

          const failBootstrap = (error: Error) => {
            if (settled) return;
            settled = true;
            window.clearTimeout(timeout);
            if (ws && wsRef.current === ws) {
              ws.close();
              wsRef.current = null;
            }
            reject(error);
          };

          const timeout = window.setTimeout(() => {
            failBootstrap(new Error("连接协作环境超时"));
          }, CONNECT_TIMEOUT_MS);

          ws = new CloudAgentWS({
            onReady: () => {
              firstReady = true;
              setPhaseSync("ready");
              setStatusText("协作环境已连接");
              setErrorText(null);
              setLastActivity(Date.now());
              if (settled) return;
              settled = true;
              window.clearTimeout(timeout);
              resolve();
            },
            onActivity: (timestamp) => {
              setLastActivity(timestamp);
            },
            onMessage: (packet) => {
              if (packet.type === "proxy.reconnected") {
                setReconnectCount((count) => count + 1);
                setPhaseSync("ready");
                setStatusText("已重新连接");
                return;
              }
              if (packet.type === "cron_result") {
                const item: CronResultItem = {
                  jobId: (packet.jobId as string) || "",
                  jobName: packet.jobName as string | undefined,
                  status: (packet.status as "ok" | "error") || "error",
                  durationMs: (packet.durationMs as number) || 0,
                  resultPreview: packet.resultPreview as string | undefined,
                  error: packet.error as string | undefined,
                  timestamp: (packet.timestamp as number) || Date.now(),
                };
                setCronResults((prev) => [item, ...prev].slice(0, MAX_CRON_RESULTS));
                return;
              }
              messageHandlerRef.current?.(packet);
            },
            onFileRequest: (request) => {
              if (!wsRef.current) return;
              const workspace = workspacePathRef.current;
              if (!workspace) {
                const type = typeof request.type === "string" ? request.type : "fs.unknown";
                const reqId = typeof request.req_id === "string" ? request.req_id : undefined;
                wsRef.current.send({ type: `${type}.result`, req_id: reqId, error: "workspace path not set" });
                return;
              }
              handleFileRequest(wsRef.current, workspace, request).catch((err) => {
                console.error("[cowork] file request error:", err);
              });
            },
            onDisconnect: (reason) => {
              if (cancelled()) return;
              if (firstReady) {
                setPhaseSync("reconnecting");
                setStatusText(`连接断开（${reason}），正在重连...`);
                return;
              }

              setPhaseSync("reconnecting");
              if (shouldShowWakeupHint(reason)) {
                setStatusText("正在唤醒容器...");
              } else {
                setStatusText("容器准备中...");
              }
            },
            onReconnect: (_delayMs, attempt) => {
              if (cancelled()) return;
              setPhaseSync("reconnecting");
              if (attempt <= 2) {
                setStatusText("正在唤醒容器...");
                return;
              }
              setStatusText("容器准备中...");
            },
            onReconnectExhausted: (error) => {
              if (cancelled()) return;
              setPhaseSync("error");
              setStatusText("");
              setErrorText(error.message);
              failBootstrap(error);
            },
            onError: (error) => {
              if (cancelled()) return;
              setErrorText(error.message);
              if (!firstReady && isFatalBootstrapError(error.message)) {
                failBootstrap(error);
                return;
              }
            },
          });

          wsRef.current = ws;
          ws.connect();
        });
      } catch (error) {
        if (cancelled()) return;
        if ((error as Error).message === "cancelled") return;
        setPhaseSync("error");
        setErrorText(error instanceof Error ? error.message : "协作环境初始化失败");
      }
    },
    [setPhaseSync],
  );

  const connect = useCallback(() => {
    if (!authenticated) return;

    const p = phaseRef.current;
    if (
      p === "ready" ||
      p === "reconnecting" ||
      p === "checking" ||
      p === "provisioning" ||
      p === "connecting"
    ) {
      return;
    }

    const token = Date.now();
    cancelTokenRef.current = token;
    doBootstrap(token);
  }, [authenticated, doBootstrap]);

  const retry = useCallback(() => {
    if (!authenticated) return;

    wsRef.current?.close();
    wsRef.current = null;

    const token = Date.now();
    cancelTokenRef.current = token;
    doBootstrap(token);
  }, [authenticated, doBootstrap]);

  const disconnect = useCallback(() => {
    cancelTokenRef.current = -1;
    wsRef.current?.close();
    wsRef.current = null;
    setPhaseSync("idle");
    setStatusText("");
    setContainerName("");
    setErrorText(null);
    setLastActivity(0);
    setReconnectCount(0);
  }, [setPhaseSync]);

  useEffect(() => {
    if (!authenticated) {
      disconnect();
      return;
    }

    if (phaseRef.current === "idle" || phaseRef.current === "error") {
      connect();
    }
  }, [authenticated, connect, disconnect]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cancelTokenRef.current = -1;
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, []);

  const setMessageHandler = useCallback(
    (handler: ((packet: AgentRpcEvent) => void) | null) => {
      messageHandlerRef.current = handler;
    },
    [],
  );

  const setWorkspacePath = useCallback((path: string) => {
    workspacePathRef.current = path;
  }, []);

  const clearCronResults = useCallback(() => setCronResults([]), []);

  const isReady = phase === "ready";

  return {
    phase,
    statusText,
    containerName,
    errorText,
    isReady,
    lastActivity,
    reconnectCount,
    wsRef,
    connect,
    retry,
    disconnect,
    setMessageHandler,
    setWorkspacePath,
    cronResults,
    clearCronResults,
  };
}
