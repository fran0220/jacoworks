import { Cloud, LoaderCircle, RefreshCw, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { OcConnectionPhase } from "../hooks/use-cowork-connection";
import OcChatView from "./components/OcChatView";
import Provision from "./components/Provision";
import {
  createOcSession,
  generateOcTitle,
  getOcSession,
  listOcSessions,
  updateOcSession,
} from "./lib/sessions";
import type { CoworkWS } from "./lib/ws";
import {
  createOcId,
  type OcAttachment,
  type OcEvent,
  type OcMessage,
  type OcRes,
  type OcSession,
} from "./types";

const SESSION_KEY = "main";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  return value as Record<string, unknown>;
}

function extractFinalText(payloadMessage: unknown): string {
  if (typeof payloadMessage === "string") return payloadMessage;
  const message = asRecord(payloadMessage);
  if (!message) return "";

  if (typeof message.content === "string") return message.content;
  if (typeof message.text === "string") return message.text;

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
  if (!item) return "协作请求失败";
  if (typeof item.message === "string") return item.message;
  return "协作请求失败";
}

export default function CoworkApp({
  phase,
  statusText,
  containerName,
  errorText,
  sseRef,
  onRetry,
  setEventHandler,
  setResponseHandler,
  onClose,
}: {
  phase: OcConnectionPhase;
  statusText: string;
  containerName: string;
  errorText: string | null;
  sseRef: React.MutableRefObject<CoworkWS | null>;
  onRetry: () => void;
  setEventHandler: (handler: ((event: OcEvent) => void) | null) => void;
  setResponseHandler: (handler: ((response: OcRes) => void) | null) => void;
  onClose: () => void;
}) {
  const [session, setSession] = useState<OcSession | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [messageError, setMessageError] = useState<string | null>(null);

  const sessionRef = useRef<OcSession | null>(null);
  const activeAssistantIdRef = useRef<string | null>(null);
  const sessionLoadedRef = useRef(false);
  const [streamingStartedAt, setStreamingStartedAt] = useState<number | null>(null);

  const connectionReady = phase === "ready";

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
      if (persist) persistSession(next);
    },
    [persistSession, updateSession],
  );

  const loadOrCreateSession = useCallback(async () => {
    const existing = await listOcSessions();
    if (existing.length > 0) {
      const latest = existing[0];
      const full = await getOcSession(latest.id);
      updateSession(full ?? latest);
      return;
    }
    const created = await createOcSession({ sessionKey: SESSION_KEY });
    updateSession(created);
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
      setIsStreaming(false);
      setStreamingStartedAt(null);
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

  // --- Event handlers (registered with hook) ---

  const handleOcEvent = useCallback(
    (event: OcEvent) => {
      if (event.event === "agent") {
        const payload = asRecord(event.payload);
        if (!payload) return;

        const stream = typeof payload.stream === "string" ? payload.stream : "";
        const data = asRecord(payload.data);

        if (stream === "assistant") {
          const delta = typeof data?.delta === "string" ? data.delta : "";
          if (delta) appendAssistantDelta(delta);
          return;
        }

        if (stream === "lifecycle") {
          const p = typeof data?.phase === "string" ? data.phase : "";
          if (p === "start") setIsStreaming(true);
          if (p === "end") finalizeStreamingMessage();
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

  const handleOcResponse = useCallback((response: OcRes) => {
    if (!response.error) return;
    setMessageError(responseError(response.error));
  }, []);

  // Register/unregister event handlers
  useEffect(() => {
    setEventHandler(handleOcEvent);
  }, [handleOcEvent, setEventHandler]);

  useEffect(() => {
    setResponseHandler(handleOcResponse);
  }, [handleOcResponse, setResponseHandler]);

  useEffect(() => {
    return () => {
      setEventHandler(null);
      setResponseHandler(null);
    };
  }, [setEventHandler, setResponseHandler]);

  // Load session when connection becomes ready
  useEffect(() => {
    if (connectionReady && !sessionLoadedRef.current) {
      sessionLoadedRef.current = true;
      loadOrCreateSession().catch(() => {});
    }
  }, [connectionReady, loadOrCreateSession]);

  // --- Send / Abort ---

  const sendMessage = useCallback(
    async (text: string, attachments: OcAttachment[] = []) => {
      const messageText = text.trim();
      if (!messageText && attachments.length === 0) return;

      const sse = sseRef.current;
      if (!sse) {
        setMessageError("协作连接尚未建立");
        return;
      }

      setMessageError(null);

      if (!sessionRef.current) {
        await loadOrCreateSession();
      }

      const displayText = messageText || (attachments.length > 0 ? `[图片 ×${attachments.length}]` : "");
      const userMessage: OcMessage = {
        id: createOcId(),
        role: "user",
        content: displayText,
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
      setStreamingStartedAt(Date.now());

      try {
        await sse.sendChat({
          sessionKey: SESSION_KEY,
          message: messageText || "请查看图片",
          idempotencyKey: createOcId(),
          attachments: attachments.length > 0 ? attachments : undefined,
        });
      } catch (error) {
        setMessageError(error instanceof Error ? error.message : "发送失败");
        setIsStreaming(false);
        activeAssistantIdRef.current = null;

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
    [loadOrCreateSession, patchSession, sseRef],
  );

  const abortMessage = useCallback(() => {
    void sseRef.current?.abortChat(SESSION_KEY).catch(() => {});
    finalizeStreamingMessage();
  }, [finalizeStreamingMessage, sseRef]);

  // --- Render ---

  const statusStrip = (
    content: React.ReactNode,
  ) => (
    <div className="oc-status-strip">
      {content}
      <button type="button" className="oc-drawer-close" onClick={onClose} title="关闭协作">
        <X size={14} />
      </button>
    </div>
  );

  if (phase === "checking" || phase === "provisioning" || phase === "connecting") {
    return (
      <div className="oc-app-layout">
        <Provision phase={phase} message={statusText} detail={containerName ? `容器: ${containerName}` : undefined} onClose={onClose} />
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div className="oc-app-layout">
        {statusStrip(
          <span className="oc-connection-badge error">
            <Cloud size={12} />
            连接失败
          </span>,
        )}
        <div className="oc-provision">
          <div className="oc-provision-card error">
            <h2 className="oc-provision-title">协作启动失败</h2>
            <p className="oc-provision-message">{errorText || "未知错误"}</p>
            <div className="oc-error-actions">
              <button type="button" className="oc-action-btn primary" onClick={onRetry}>
                <RefreshCw size={14} />
                重试
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (phase === "idle") {
    return (
      <div className="oc-app-layout">
        {statusStrip(
          <span className="oc-connection-badge connecting">
            <Cloud size={12} />
            等待连接...
          </span>,
        )}
        <div className="oc-provision">
          <div className="oc-provision-card">
            <h2 className="oc-provision-title">协作</h2>
            <p className="oc-provision-message">正在初始化...</p>
          </div>
        </div>
      </div>
    );
  }

  // ready | reconnecting
  return (
    <div className="oc-app-layout">
      {statusStrip(
        <>
          {phase === "reconnecting" && (
            <span className="oc-connection-badge reconnecting">
              <LoaderCircle size={12} className="spinning" />
              {statusText}
            </span>
          )}
          {containerName && <span className="oc-container-badge">{containerName}</span>}
        </>,
      )}

      <OcChatView
        session={session}
        isStreaming={isStreaming}
        streamingStartedAt={streamingStartedAt}
        errorText={messageError}
        disabled={!connectionReady}
        onSend={(text, attachments) => {
          sendMessage(text, attachments).catch((error) => {
            setMessageError(error instanceof Error ? error.message : "发送消息失败");
          });
        }}
        onAbort={abortMessage}
      />
    </div>
  );
}
