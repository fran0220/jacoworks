import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getToken } from "../../lib/auth";
import { GATEWAY_URL } from "../../lib/config";
import { httpFetch } from "../../lib/transport";
import {
  createOcId,
  type OcChatAbortParams,
  type OcChatSendParams,
  type OcEvent,
  type OcRes,
} from "../types";

const RECONNECT_NOTICE_DELAY_MS = 1_000;

export interface OpenClawSSEHandlers {
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

export class OpenClawSSE {
  private connected = false;
  private shouldReconnect = false;
  private ready = false;
  private reconnectAttempt = 0;
  private unlistenEvent: UnlistenFn | null = null;
  private unlistenClosed: UnlistenFn | null = null;

  constructor(private handlers: OpenClawSSEHandlers = {}) {}

  get isReady() {
    return this.ready;
  }

  connect() {
    this.shouldReconnect = true;
    if (this.connected) {
      return;
    }
    this.openSource();
  }

  close() {
    this.shouldReconnect = false;
    this.ready = false;
    this.cleanup();
  }

  async sendChat(params: { sessionKey: string; message: string; idempotencyKey?: string }) {
    const payload: OcChatSendParams = {
      sessionKey: params.sessionKey,
      message: params.message,
      deliver: true,
      idempotencyKey: params.idempotencyKey ?? createOcId(),
    };
    return this.sendCommand("chat.send", payload);
  }

  async abortChat(sessionKey: string) {
    const payload: OcChatAbortParams = { sessionKey };
    return this.sendCommand("chat.abort", payload);
  }

  private async openSource() {
    const token = getToken();
    if (!token) {
      this.handlers.onError?.(new Error("未找到登录 token，请重新登录"));
      return;
    }

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
    }
  }

  private handleSseEvent(payload: SseEventPayload) {
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
        this.handlers.onError?.(new Error(frame?.error || "OpenClaw 代理错误"));
        break;
      }
    }
  }

  private handleSseClosed(payload: SseClosedPayload) {
    const wasReady = this.ready;
    this.ready = false;
    this.connected = false;

    this.unlistenEvent?.();
    this.unlistenEvent = null;
    this.unlistenClosed?.();
    this.unlistenClosed = null;

    this.handlers.onDisconnect?.(wasReady ? "连接中断" : payload.error || "连接失败");
    this.scheduleReconnect();
  }

  private scheduleReconnect() {
    if (!this.shouldReconnect) return;

    this.reconnectAttempt += 1;
    this.handlers.onReconnect?.(RECONNECT_NOTICE_DELAY_MS, this.reconnectAttempt);

    window.setTimeout(() => {
      if (!this.shouldReconnect || this.connected) return;
      this.openSource();
    }, RECONNECT_NOTICE_DELAY_MS);
  }

  private cleanup() {
    this.connected = false;
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
      throw new Error(parseHttpError(response.body, `OpenClaw 请求失败 (${response.status})`));
    }

    const body = parseJson<{ ok?: boolean; requestId?: string; error?: string }>(response.body);
    if (!body?.ok || !body.requestId) {
      throw new Error(body?.error || "OpenClaw 请求失败");
    }

    return body.requestId;
  }
}
