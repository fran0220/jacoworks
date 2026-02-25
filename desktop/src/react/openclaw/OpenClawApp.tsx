import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import OcChatView from "./components/OcChatView";
import OcTopBar from "./components/OcTopBar";
import Provision from "./components/Provision";
import { checkContainerStatus, provisionContainer } from "./lib/api";
import {
  createOcSession,
  generateOcTitle,
  getOcSession,
  listOcSessions,
  updateOcSession,
} from "./lib/sessions";
import { OpenClawSSE } from "./lib/sse";
import { createOcId, type OcEvent, type OcMessage, type OcSession } from "./types";

type AppPhase = "checking" | "provisioning" | "connecting" | "ready" | "error";

const SESSION_KEY = "main";
const PROVISION_POLL_MS = 2_000;
const PROVISION_MAX_ATTEMPTS = 60;
const CONNECT_TIMEOUT_MS = 25_000;

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  return value as Record<string, unknown>;
}

function extractFinalText(payloadMessage: unknown): string {
  if (typeof payloadMessage === "string") return payloadMessage;
  const message = asRecord(payloadMessage);
  if (!message) return "";

  if (typeof message.content === "string") {
    return message.content;
  }

  if (typeof message.text === "string") {
    return message.text;
  }

  if (Array.isArray(message.content)) {
    return message.content
      .map((part) => {
        if (typeof part === "string") return part;
        const item = asRecord(part);
        if (!item) return "";
        return typeof item.text === "string" ? item.text : "";
      })
      .join("\n")
      .trim();
  }

  return "";
}

function responseError(error: unknown): string {
  if (typeof error === "string") return error;
  const item = asRecord(error);
  if (!item) return "OpenClaw 请求失败";
  if (typeof item.message === "string") return item.message;
  return "OpenClaw 请求失败";
}

export default function OpenClawApp({ onBack }: { onBack: () => void }) {
  const [phase, setPhase] = useState<AppPhase>("checking");
  const [statusText, setStatusText] = useState("正在检查容器状态...");
  const [errorText, setErrorText] = useState<string | null>(null);
  const [containerName, setContainerName] = useState("");
  const [session, setSession] = useState<OcSession | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [bootNonce, setBootNonce] = useState(0);

  const sseRef = useRef<OpenClawSSE | null>(null);
  const sessionRef = useRef<OcSession | null>(null);
  const activeAssistantIdRef = useRef<string | null>(null);
  const activeRequestIdRef = useRef<string | null>(null);
  const lastDisconnectReasonRef = useRef("未知原因");

  const updateSession = useCallback((next: OcSession) => {
    sessionRef.current = next;
    setSession(next);
  }, []);

  const persistSession = useCallback((s: OcSession) => {
    void updateOcSession(s.id, {
      title: s.title,
      messages: s.messages,
      model: s.model,
      workspacePath: s.workspacePath,
    }).catch(() => {});
  }, []);

  const patchSession = useCallback(
    (updater: (s: OcSession) => OcSession, persist = false) => {
      const current = sessionRef.current;
      if (!current) return;

      const next = updater(current);
      updateSession(next);

      if (persist) {
        persistSession(next);
      }
    },
    [persistSession, updateSession],
  );

  const loadOrCreateSession = useCallback(async (): Promise<string> => {
    const existing = await listOcSessions();
    if (existing.length > 0) {
      const latest = existing[0];
      const full = await getOcSession(latest.id);
      const s = full ?? latest;
      updateSession(s);
      return s.id;
    }

    const created = await createOcSession({ sessionKey: SESSION_KEY });
    updateSession(created);
    return created.id;
  }, [updateSession]);

  const finalizeStreamingMessage = useCallback(
    (finalText?: string) => {
      const assistantMessageId = activeAssistantIdRef.current;
      if (!sessionRef.current || !assistantMessageId) {
        setIsStreaming(false);
        return;
      }

      patchSession((s) => {
        const messages = s.messages.map((m) => {
          if (m.id !== assistantMessageId) return m;
          return {
            ...m,
            content: finalText && finalText.trim() ? finalText : m.content,
            status: "final" as const,
          };
        });
        const firstAssistant = messages.find(
          (m) => m.role === "assistant" && m.content.trim().length > 0,
        );

        const nextTitle =
          s.title === "新会话" && firstAssistant
            ? generateOcTitle(firstAssistant.content)
            : s.title;

        return { ...s, messages, title: nextTitle, updatedAt: Date.now() };
      }, true);

      activeAssistantIdRef.current = null;
      activeRequestIdRef.current = null;
      setIsStreaming(false);
    },
    [patchSession],
  );

  const appendAssistantDelta = useCallback(
    (delta: string) => {
      const assistantMessageId = activeAssistantIdRef.current;
      if (!sessionRef.current || !assistantMessageId) return;

      patchSession((s) => ({
        ...s,
        updatedAt: Date.now(),
        messages: s.messages.map((m) => {
          if (m.id !== assistantMessageId) return m;
          return { ...m, content: `${m.content}${delta}`, status: "streaming" as const };
        }),
      }));
    },
    [patchSession],
  );

  const handleOcEvent = useCallback(
    (event: OcEvent) => {
      if (event.event === "agent") {
        const payload = asRecord(event.payload);
        if (!payload) return;

        const stream = typeof payload.stream === "string" ? payload.stream : "";
        const data = asRecord(payload.data);

        if (stream === "assistant") {
          const delta = typeof data?.delta === "string" ? data.delta : "";
          if (delta) {
            appendAssistantDelta(delta);
          }
          return;
        }

        if (stream === "lifecycle") {
          const p = typeof data?.phase === "string" ? data.phase : "";
          if (p === "start") {
            setIsStreaming(true);
          }
          if (p === "end") {
            finalizeStreamingMessage();
          }
        }
        return;
      }

      if (event.event === "chat") {
        const payload = asRecord(event.payload);
        if (!payload) return;
        if (payload.state !== "final") return;

        const finalText = extractFinalText(payload.message);
        finalizeStreamingMessage(finalText);
      }
    },
    [appendAssistantDelta, finalizeStreamingMessage],
  );

  const connectAndWaitReady = useCallback(() => {
    return new Promise<void>((resolve, reject) => {
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
          setPhase("ready");
          setStatusText("OpenClaw 已连接");
          if (settled) return;
          settled = true;
          window.clearTimeout(timeout);
          resolve();
        },
        onEvent: handleOcEvent,
        onResponse: (response) => {
          if (!response.error) return;
          setErrorText(responseError(response.error));
          if (activeRequestIdRef.current && response.id === activeRequestIdRef.current) {
            finalizeStreamingMessage();
          }
        },
        onDisconnect: (reason) => {
          setIsStreaming(false);
          lastDisconnectReasonRef.current = reason || "未知原因";
          if (!firstReady && !settled) {
            settled = true;
            window.clearTimeout(timeout);
            reject(new Error("连接 OpenClaw 失败，已断开"));
            return;
          }
          setPhase("connecting");
          setStatusText(`连接断开（${lastDisconnectReasonRef.current}），正在重连...`);
        },
        onReconnect: () => {
          setStatusText(`连接断开（${lastDisconnectReasonRef.current}），正在重连...`);
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
  }, [finalizeStreamingMessage, handleOcEvent]);

  const sendMessage = useCallback(
    async (text: string) => {
      const messageText = text.trim();
      if (!messageText) return;

      const sse = sseRef.current;
      if (!sse) {
        setErrorText("OpenClaw 连接尚未建立");
        return;
      }

      setErrorText(null);

      if (!sessionRef.current) {
        await loadOrCreateSession();
      }

      const userMessage: OcMessage = {
        id: createOcId(),
        role: "user",
        content: messageText,
        createdAt: Date.now(),
        status: "final",
      };
      const assistantMessage: OcMessage = {
        id: createOcId(),
        role: "assistant",
        content: "",
        createdAt: Date.now(),
        status: "streaming",
      };

      patchSession(
        (s) => ({
          ...s,
          updatedAt: Date.now(),
          messages: [...s.messages, userMessage, assistantMessage],
        }),
        true,
      );

      activeAssistantIdRef.current = assistantMessage.id;
      setIsStreaming(true);

      try {
        const requestId = await sse.sendChat({
          sessionKey: SESSION_KEY,
          message: messageText,
          idempotencyKey: createOcId(),
        });
        activeRequestIdRef.current = requestId;
      } catch (error) {
        setErrorText(error instanceof Error ? error.message : "发送失败");
        setIsStreaming(false);
        activeAssistantIdRef.current = null;
        activeRequestIdRef.current = null;

        patchSession(
          (s) => ({
            ...s,
            updatedAt: Date.now(),
            messages: s.messages.map((m) => {
              if (m.id !== assistantMessage.id) return m;
              return { ...m, status: "error" as const };
            }),
          }),
          true,
        );
      }
    },
    [loadOrCreateSession, patchSession],
  );

  const abortMessage = useCallback(() => {
    void sseRef.current?.abortChat(SESSION_KEY).catch(() => {});
    finalizeStreamingMessage();
  }, [finalizeStreamingMessage]);

  useEffect(() => {
    let cancelled = false;
    sseRef.current?.close();
    sseRef.current = null;

    setIsStreaming(false);
    setErrorText(null);
    setStatusText("正在检查容器状态...");
    setPhase("checking");

    const bootstrap = async () => {
      try {
        const status = await checkContainerStatus();
        if (cancelled) return;

        if (status.container_name) {
          setContainerName(status.container_name);
        }

        if (!status.provisioned) {
          setPhase("provisioning");
          setStatusText("正在分配 OpenClaw 容器...");
          const provision = await provisionContainer();
          if (cancelled) return;

          if (provision.container_name) {
            setContainerName(provision.container_name);
          }

          let ready = false;
          for (let i = 0; i < PROVISION_MAX_ATTEMPTS; i += 1) {
            if (cancelled) return;
            setStatusText(`容器准备中 (${i + 1}/${PROVISION_MAX_ATTEMPTS})...`);
            await sleep(PROVISION_POLL_MS);

            const polledStatus = await checkContainerStatus();
            if (polledStatus.container_name) {
              setContainerName(polledStatus.container_name);
            }
            if (polledStatus.provisioned) {
              ready = true;
              break;
            }
          }

          if (!ready) {
            throw new Error("容器分配超时，请稍后重试");
          }
        }

        if (cancelled) return;
        setPhase("connecting");
        setStatusText("正在连接 OpenClaw...");

        await connectAndWaitReady();
        if (cancelled) return;

        await loadOrCreateSession();
      } catch (error) {
        if (cancelled) return;
        setPhase("error");
        setErrorText(error instanceof Error ? error.message : "OpenClaw 初始化失败");
      }
    };

    bootstrap().catch(() => {});

    return () => {
      cancelled = true;
      sseRef.current?.close();
      sseRef.current = null;
    };
  }, [bootNonce, connectAndWaitReady, loadOrCreateSession]);

  if (phase === "checking" || phase === "provisioning" || phase === "connecting") {
    return (
      <Provision
        phase={phase}
        message={statusText}
        detail={containerName ? `容器: ${containerName}` : undefined}
      />
    );
  }

  if (phase === "error") {
    return (
      <div className="oc-provision">
        <div className="oc-provision-card error">
          <h2 className="oc-provision-title">OpenClaw 启动失败</h2>
          <p className="oc-provision-message">{errorText || "未知错误"}</p>
          <div className="oc-error-actions">
            <button
              type="button"
              className="oc-action-btn primary"
              onClick={() => setBootNonce((v) => v + 1)}
            >
              <RefreshCw size={14} />
              重试
            </button>
            <button type="button" className="oc-action-btn" onClick={onBack}>
              返回本地模式
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="oc-app-layout">
      <OcTopBar
        status={phase === "ready" ? "ready" : "connecting"}
        containerName={containerName}
        onBack={() => {
          sseRef.current?.close();
          onBack();
        }}
      />

      <OcChatView
        session={session}
        isStreaming={isStreaming}
        errorText={errorText}
        onSend={(text) => {
          sendMessage(text).catch((error) => {
            setErrorText(error instanceof Error ? error.message : "发送消息失败");
          });
        }}
        onAbort={abortMessage}
      />
    </div>
  );
}
