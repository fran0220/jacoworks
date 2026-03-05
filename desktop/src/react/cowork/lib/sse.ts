import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getToken } from "../../lib/auth";
import { GATEWAY_URL } from "../../lib/config";
import { httpFetch } from "../../lib/transport";
import {
  createOcId,
  type OcAttachment,
  type OcChatAbortParams,
  type OcChatSendParams,
  type OcEvent,
  type OcRes,
} from "../types";

const RECONNECT_NOTICE_DELAY_MS = 1_000;

export interface CoworkSSEHandlers {
  onReady?: () => void;
  onEvent?: (event: OcEvent) => void;
  onResponse?: (response: OcRes) => void;
  onDisconnect?: (reason: string) => void;
  onError?: (error: Error) => void;
  onReconnect?: (delayMs: number, attempt: number) => void;
}

interface SseEventPayload {
  event: string;
  data: string;
  id?: string;
}

interface SseClosedPayload {
  error: string;
}

function buildStreamUrl() {
  const base = GATEWAY_URL.replace(/\/$/, "");
  return `${base}/api/oc/stream`;
}

function parseJson<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function parseHttpError(body: string, fallback: string) {
  const parsed = parseJson<{ error?: string; message?: string }>(body);
  return parsed?.error || parsed?.message || fallback;
}

export class CoworkSSE {
  private connected = false;
  private connecting = false;
  private shouldReconnect = false;
  private ready = false;
  private reconnectAttempt = 0;
  private reconnectTimer: number | null = null;
  private lastSeenSeq = 0;
  private unlistenEvent: UnlistenFn | null = null;
  private unlistenClosed: UnlistenFn | null = null;

  constructor(private handlers: CoworkSSEHandlers = {}) {}

  get isReady() {
    return this.ready;
  }

  connect() {
    this.shouldReconnect = true;
    if (this.connected || this.connecting) {
      return;
    }
    this.openSource();
  }

  close() {
    this.shouldReconnect = false;
    this.ready = false;
    this.cancelReconnectTimer();
    this.cleanup();
  }

  async sendChat(params: {
    sessionKey: string;
    message: string;
    idempotencyKey?: string;
    attachments?: OcAttachment[];
  }) {
    const payload: OcChatSendParams = {
      sessionKey: params.sessionKey,
      message: params.message,
      deliver: true,
      idempotencyKey: params.idempotencyKey ?? createOcId(),
    };
    if (params.attachments && params.attachments.length > 0) {
      payload.attachments = params.attachments;
    }
    return this.sendCommand("chat.send", payload);
  }

  async abortChat(sessionKey: string) {
    const payload: OcChatAbortParams = { sessionKey };
    return this.sendCommand("chat.abort", payload);
  }

  private async openSource() {
    if (this.connected || this.connecting) return;

    const token = getToken();
    if (!token) {
      this.handlers.onError?.(new Error("未找到登录 token，请重新登录"));
      return;
    }

    this.connecting = true;

    // Always clean up old listeners before registering new ones
    this.unlistenEvent?.();
    this.unlistenEvent = null;
    this.unlistenClosed?.();
    this.unlistenClosed = null;

    try {
      this.unlistenEvent = await listen<SseEventPayload>("oc-sse-event", ({ payload }) => {
        this.handleSseEvent(payload);
      });

      this.unlistenClosed = await listen<SseClosedPayload>("oc-sse-closed", ({ payload }) => {
        this.handleSseClosed(payload);
      });

      await invoke("sse_connect", {
        url: buildStreamUrl(),
        headers: { Authorization: `Bearer ${token}` },
      });

      this.connected = true;
    } catch (err) {
      this.cleanup();
      this.handlers.onError?.(new Error(err instanceof Error ? err.message : String(err)));
      this.scheduleReconnect();
    } finally {
      this.connecting = false;
    }
  }

  private handleSseEvent(payload: SseEventPayload) {
    // Seq-based dedup: skip events we've already processed
    if (payload.id) {
      const seq = Number(payload.id);
      if (Number.isFinite(seq) && seq > 0) {
        if (seq <= this.lastSeenSeq) return;
        this.lastSeenSeq = seq;
      }
    }

    switch (payload.event) {
      case "proxy.ready":
        this.ready = true;
        this.reconnectAttempt = 0;
        this.handlers.onReady?.();
        break;
      case "agent":
      case "chat": {
        const frame = parseJson<OcEvent>(payload.data);
        if (frame) this.handlers.onEvent?.(frame);
        break;
      }
      case "response": {
        const frame = parseJson<OcRes>(payload.data);
        if (frame) this.handlers.onResponse?.(frame);
        break;
      }
      case "proxy.error": {
        const frame = parseJson<{ error?: string }>(payload.data);
        this.handlers.onError?.(new Error(frame?.error || "协作代理错误"));
        break;
      }
    }
  }

  private handleSseClosed(payload: SseClosedPayload) {
    const wasReady = this.ready;
    this.ready = false;
    this.connected = false;
    this.connecting = false;

    this.unlistenEvent?.();
    this.unlistenEvent = null;
    this.unlistenClosed?.();
    this.unlistenClosed = null;

    this.handlers.onDisconnect?.(wasReady ? "连接中断" : payload.error || "连接失败");
    this.scheduleReconnect();
  }

  private scheduleReconnect() {
    if (!this.shouldReconnect) return;

    this.cancelReconnectTimer();

    this.reconnectAttempt += 1;
    this.handlers.onReconnect?.(RECONNECT_NOTICE_DELAY_MS, this.reconnectAttempt);

    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.shouldReconnect || this.connected || this.connecting) return;
      this.openSource();
    }, RECONNECT_NOTICE_DELAY_MS);
  }

  private cancelReconnectTimer() {
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private cleanup() {
    this.connected = false;
    this.connecting = false;
    this.unlistenEvent?.();
    this.unlistenEvent = null;
    this.unlistenClosed?.();
    this.unlistenClosed = null;
    invoke("sse_close").catch(() => {});
  }

  private async sendCommand<TParams extends object>(method: string, params: TParams) {
    const token = getToken();
    if (!token) {
      throw new Error("未登录，请重新登录");
    }

    const base = GATEWAY_URL.replace(/\/$/, "");
    const response = await httpFetch(`${base}/api/oc/send`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ method, params }),
    });

    if (response.status !== 200) {
      throw new Error(parseHttpError(response.body, `协作请求失败 (${response.status})`));
    }

    const body = parseJson<{ ok?: boolean; requestId?: string; error?: string }>(response.body);
    if (!body?.ok || !body.requestId) {
      throw new Error(body?.error || "协作请求失败");
    }

    return body.requestId;
  }
}
