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

function buildStreamUrl(token: string) {
  const base = GATEWAY_URL.replace(/\/$/, "");
  return `${base}/api/oc/stream?token=${encodeURIComponent(token)}`;
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
  private source: EventSource | null = null;
  private shouldReconnect = false;
  private ready = false;
  private reconnectAttempt = 0;

  constructor(private handlers: OpenClawSSEHandlers = {}) {}

  get isReady() {
    return this.ready;
  }

  connect() {
    this.shouldReconnect = true;
    if (this.source) {
      return;
    }
    this.openSource();
  }

  close() {
    this.shouldReconnect = false;
    this.ready = false;
    if (this.source) {
      this.source.close();
    }
    this.source = null;
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

  private openSource() {
    const token = getToken();
    if (!token) {
      this.handlers.onError?.(new Error("未找到登录 token，请重新登录"));
      return;
    }

    const source = new EventSource(buildStreamUrl(token));
    this.source = source;

    source.addEventListener("proxy.ready", () => {
      this.ready = true;
      this.reconnectAttempt = 0;
      this.handlers.onReady?.();
    });

    source.addEventListener("agent", (event) => {
      const frame = parseJson<OcEvent>((event as MessageEvent<string>).data);
      if (!frame) return;
      this.handlers.onEvent?.(frame);
    });

    source.addEventListener("chat", (event) => {
      const frame = parseJson<OcEvent>((event as MessageEvent<string>).data);
      if (!frame) return;
      this.handlers.onEvent?.(frame);
    });

    source.addEventListener("response", (event) => {
      const frame = parseJson<OcRes>((event as MessageEvent<string>).data);
      if (!frame) return;
      this.handlers.onResponse?.(frame);
    });

    source.addEventListener("proxy.error", (event) => {
      const frame = parseJson<{ error?: string }>((event as MessageEvent<string>).data);
      this.handlers.onError?.(new Error(frame?.error || "OpenClaw 代理错误"));
    });

    source.onerror = () => {
      if (source !== this.source) return;

      const wasReady = this.ready;
      this.ready = false;
      this.handlers.onDisconnect?.(wasReady ? "连接中断" : "连接失败");

      if (!this.shouldReconnect) {
        return;
      }

      this.reconnectAttempt += 1;
      this.handlers.onReconnect?.(RECONNECT_NOTICE_DELAY_MS, this.reconnectAttempt);

      if (source.readyState === EventSource.CLOSED) {
        this.source = null;
        window.setTimeout(() => {
          if (!this.shouldReconnect || this.source) return;
          this.openSource();
        }, RECONNECT_NOTICE_DELAY_MS);
      }
    };
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
