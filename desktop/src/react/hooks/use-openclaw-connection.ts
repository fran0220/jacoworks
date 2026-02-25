import { useCallback, useEffect, useRef, useState } from "react";
import { checkContainerStatus, provisionContainer } from "../openclaw/lib/api";
import { OpenClawSSE } from "../openclaw/lib/sse";
import type { OcEvent, OcRes } from "../openclaw/types";

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

/** Check if an OcEvent represents a new agent response starting */
function isNewResponseEvent(event: OcEvent): boolean {
  if (event.event !== "agent") return false;
  const payload = event.payload as Record<string, unknown> | undefined;
  if (!payload) return false;
  const stream = typeof payload.stream === "string" ? payload.stream : "";
  if (stream !== "lifecycle") return false;
  const data = payload.data as Record<string, unknown> | undefined;
  return data?.phase === "start";
}

export function useOpenClawConnection() {
  const [phase, setPhase] = useState<OcConnectionPhase>("idle");
  const [statusText, setStatusText] = useState("");
  const [containerName, setContainerName] = useState("");
  const [errorText, setErrorText] = useState<string | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);

  const sseRef = useRef<OpenClawSSE | null>(null);
  const phaseRef = useRef<OcConnectionPhase>("idle");
  const cancelTokenRef = useRef(0);
  const drawerOpenRef = useRef(false);
  const eventHandlerRef = useRef<((event: OcEvent) => void) | null>(null);
  const responseHandlerRef = useRef<((response: OcRes) => void) | null>(null);

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

      try {
        const status = await checkContainerStatus();
        if (cancelled()) return;

        if (status.container_name) setContainerName(status.container_name);

        if (!status.provisioned) {
          setPhaseSync("provisioning");
          setStatusText("正在分配 OpenClaw 容器...");
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
            if (polled.provisioned) {
              ready = true;
              break;
            }
          }

          if (!ready) throw new Error("容器分配超时，请稍后重试");
        }

        if (cancelled()) return;
        setPhaseSync("connecting");
        setStatusText("正在连接 OpenClaw...");

        // Create SSE and wait for ready
        await new Promise<void>((resolve, reject) => {
          if (cancelled()) {
            reject(new Error("cancelled"));
            return;
          }

          let settled = false;
          let firstReady = false;
          const timeout = window.setTimeout(() => {
            if (settled) return;
            settled = true;
            reject(new Error("连接 OpenClaw 超时"));
          }, CONNECT_TIMEOUT_MS);

          const sse = new OpenClawSSE({
            onReady: () => {
              firstReady = true;
              setPhaseSync("ready");
              setStatusText("OpenClaw 已连接");
              setErrorText(null);
              if (settled) return;
              settled = true;
              window.clearTimeout(timeout);
              resolve();
            },
            onEvent: (event) => {
              eventHandlerRef.current?.(event);
              if (!drawerOpenRef.current && isNewResponseEvent(event)) {
                setUnreadCount((c) => c + 1);
              }
            },
            onResponse: (response) => {
              responseHandlerRef.current?.(response);
            },
            onDisconnect: (reason) => {
              if (!firstReady && !settled) {
                settled = true;
                window.clearTimeout(timeout);
                reject(new Error(reason || "连接失败"));
                return;
              }
              if (firstReady) {
                setPhaseSync("reconnecting");
                setStatusText(`连接断开（${reason}），正在重连...`);
              }
            },
            onReconnect: () => {
              setStatusText("正在重连 OpenClaw...");
            },
            onError: (error) => {
              if (!firstReady && !settled) {
                settled = true;
                window.clearTimeout(timeout);
                reject(error);
                return;
              }
              setErrorText(error.message);
            },
          });

          sseRef.current = sse;
          sse.connect();
        });
      } catch (error) {
        if (cancelled()) return;
        if ((error as Error).message === "cancelled") return;
        setPhaseSync("error");
        setErrorText(error instanceof Error ? error.message : "OpenClaw 初始化失败");
      }
    },
    [setPhaseSync],
  );

  const connect = useCallback(() => {
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
  }, [doBootstrap]);

  const retry = useCallback(() => {
    sseRef.current?.close();
    sseRef.current = null;

    const token = Date.now();
    cancelTokenRef.current = token;
    doBootstrap(token);
  }, [doBootstrap]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cancelTokenRef.current = -1;
      sseRef.current?.close();
      sseRef.current = null;
    };
  }, []);

  const setEventHandler = useCallback((handler: ((event: OcEvent) => void) | null) => {
    eventHandlerRef.current = handler;
  }, []);

  const setResponseHandler = useCallback((handler: ((response: OcRes) => void) | null) => {
    responseHandlerRef.current = handler;
  }, []);

  const setDrawerOpen = useCallback((open: boolean) => {
    drawerOpenRef.current = open;
    if (open) setUnreadCount(0);
  }, []);

  return {
    phase,
    statusText,
    containerName,
    errorText,
    unreadCount,
    sseRef,
    connect,
    retry,
    setEventHandler,
    setResponseHandler,
    setDrawerOpen,
  };
}
