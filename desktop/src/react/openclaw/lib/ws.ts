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

const PING_INTERVAL_MS = 30_000;
const RECONNECT_BASE_DELAY_MS = 1_000;
const RECONNECT_MAX_DELAY_MS = 15_000;
const RECONNECT_JITTER_RATIO = 0.2;

export interface OpenClawWSHandlers {
  onReady?: () => void;
  onEvent?: (event: OcEvent) => void;
  onResponse?: (response: OcRes) => void;
  onDisconnect?: (reason: string) => void;
  onError?: (error: Error) => void;
  onReconnect?: (delayMs: number, attempt: number) => void;
}

interface WsTicketResponse {
  ticket?: string;
  error?: string;
  message?: string;
}

interface WsReqFrame<TParams extends object> {
  type: "req";
  id: string;
  method: string;
  params: TParams;
}

function parseJson<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  return value as Record<string, unknown>;
}

function parseHttpError(body: string, fallback: string) {
  const parsed = parseJson<{ error?: string; message?: string }>(body);
  return parsed?.error || parsed?.message || fallback;
}

function normalizeErrorMessage(value: unknown, fallback: string) {
  if (typeof value === "string" && value.trim()) return value;
  const record = asRecord(value);
  if (!record) return fallback;
  if (typeof record.error === "string" && record.error.trim()) return record.error;
  if (typeof record.message === "string" && record.message.trim()) return record.message;
  return fallback;
}

function buildWebSocketUrl(ticket: string, lastSeq: number) {
  const base = GATEWAY_URL.replace(/\/$/, "");
  const url = new URL(base);

  if (url.protocol === "https:") {
    url.protocol = "wss:";
  } else if (url.protocol === "http:") {
    url.protocol = "ws:";
  } else if (url.protocol !== "ws:" && url.protocol !== "wss:") {
    throw new Error(`不支持的网关协议: ${url.protocol}`);
  }

  url.pathname = "/ws/oc";
  url.search = "";
  url.searchParams.set("ticket", ticket);
  url.searchParams.set("lastSeq", String(lastSeq));
  return url.toString();
}

function getReconnectDelayMs(attempt: number) {
  const exponential = Math.min(
    RECONNECT_BASE_DELAY_MS * 2 ** Math.max(0, attempt - 1),
    RECONNECT_MAX_DELAY_MS,
  );
  const jitterSpan = exponential * RECONNECT_JITTER_RATIO;
  const delay = exponential - jitterSpan + Math.random() * jitterSpan * 2;
  return Math.max(RECONNECT_BASE_DELAY_MS, Math.round(delay));
}

function toOcEvent(event: string, data: unknown): OcEvent {
  const parsed = asRecord(data);
  if (parsed && parsed.type === "event" && typeof parsed.event === "string") {
    return parsed as unknown as OcEvent;
  }

  if (data === undefined) {
    return { type: "event", event };
  }

  return { type: "event", event, payload: data };
}

function toOcResponse(data: unknown): OcRes | null {
  const parsed = asRecord(data);
  if (!parsed) {
    if (typeof data === "string" && data.trim()) {
      return { type: "res", id: "", error: data };
    }
    return null;
  }

  if (parsed.type === "res" && typeof parsed.id === "string") {
    return parsed as unknown as OcRes;
  }

  const response: OcRes = {
    type: "res",
    id: typeof parsed.id === "string" ? parsed.id : "",
  };

  if (typeof parsed.ok === "boolean") {
    response.ok = parsed.ok;
  }
  if ("result" in parsed) {
    response.result = parsed.result;
  }
  if ("error" in parsed) {
    response.error = parsed.error as string | { message?: string };
  }

  return response;
}

export class OpenClawWS {
  private socket: WebSocket | null = null;
  private connected = false;
  private connecting = false;
  private shouldReconnect = false;
  private ready = false;
  private reconnectAttempt = 0;
  private reconnectTimer: number | null = null;
  private pingTimer: number | null = null;
  private lastSeenSeq = 0;
  private connectRunId = 0;
  private lifecycleListenersBound = false;

  constructor(private handlers: OpenClawWSHandlers = {}) {}

  get isReady() {
    return this.ready;
  }

  connect() {
    this.shouldReconnect = true;
    this.bindLifecycleListeners();

    if (this.connected || this.connecting) {
      return;
    }

    void this.openSocket();
  }

  close() {
    this.shouldReconnect = false;
    this.ready = false;
    this.reconnectAttempt = 0;

    this.cancelReconnectTimer();
    this.stopPing();
    this.unbindLifecycleListeners();

    this.connectRunId += 1;
    this.teardownSocket();
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

  private async openSocket() {
    if (this.connected || this.connecting) return;

    const token = getToken();
    if (!token) {
      this.handlers.onError?.(new Error("未找到登录 token，请重新登录"));
      return;
    }

    this.connecting = true;
    const runId = ++this.connectRunId;

    try {
      const ticket = await this.fetchTicket(token);
      if (runId !== this.connectRunId) {
        return;
      }

      if (!this.shouldReconnect) {
        this.connecting = false;
        return;
      }

      const socket = new WebSocket(buildWebSocketUrl(ticket, this.lastSeenSeq));
      this.socket = socket;

      socket.onopen = () => {
        if (!this.isActiveSocket(socket, runId)) return;
        this.connected = true;
        this.connecting = false;
        this.startPing();
      };

      socket.onmessage = (event) => {
        if (!this.isActiveSocket(socket, runId)) return;
        this.handleIncomingData(event.data);
      };

      socket.onerror = () => {
        if (!this.isActiveSocket(socket, runId)) return;
        this.handlers.onError?.(new Error("OpenClaw WebSocket 连接错误"));
      };

      socket.onclose = (event) => {
        if (!this.isActiveSocket(socket, runId)) return;
        this.handleSocketClose(event);
      };
    } catch (error) {
      if (runId !== this.connectRunId) {
        return;
      }

      this.connected = false;
      this.connecting = false;

      if (!this.shouldReconnect) return;

      const message = error instanceof Error ? error.message : String(error);
      this.handlers.onError?.(new Error(message));
      this.scheduleReconnect();
    }
  }

  private async fetchTicket(token: string) {
    const base = GATEWAY_URL.replace(/\/$/, "");
    const response = await httpFetch(`${base}/api/oc/ws-ticket`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (response.status !== 200) {
      throw new Error(parseHttpError(response.body, `获取 OpenClaw WS ticket 失败 (${response.status})`));
    }

    const body = parseJson<WsTicketResponse>(response.body);
    if (!body?.ticket) {
      throw new Error(body?.error || body?.message || "获取 OpenClaw WS ticket 失败");
    }

    return body.ticket;
  }

  private isActiveSocket(socket: WebSocket, runId: number) {
    return this.socket === socket && runId === this.connectRunId;
  }

  private handleIncomingData(data: string | Blob | ArrayBuffer) {
    if (typeof data === "string") {
      this.handleIncomingText(data);
      return;
    }

    if (data instanceof Blob) {
      void data
        .text()
        .then((raw) => {
          this.handleIncomingText(raw);
        })
        .catch(() => {});
      return;
    }

    if (data instanceof ArrayBuffer) {
      this.handleIncomingText(new TextDecoder().decode(data));
    }
  }

  private handleIncomingText(raw: string) {
    const message = parseJson<Record<string, unknown>>(raw);
    if (!message) return;

    if (message.type === "pong") return;

    const event = typeof message.event === "string" ? message.event : "";
    if (!event) return;

    const seq = typeof message.seq === "number" ? message.seq : Number(message.seq);
    if (Number.isFinite(seq) && seq > 0) {
      if (seq <= this.lastSeenSeq) return;
      this.lastSeenSeq = seq;
    }

    const data = message.data;

    switch (event) {
      case "proxy.ready":
        this.ready = true;
        this.reconnectAttempt = 0;
        this.handlers.onReady?.();
        break;
      case "agent":
      case "chat":
        this.handlers.onEvent?.(toOcEvent(event, data));
        break;
      case "response": {
        const response = toOcResponse(data);
        if (response) {
          this.handlers.onResponse?.(response);
        }
        break;
      }
      case "proxy.error":
        this.handlers.onError?.(new Error(normalizeErrorMessage(data, "OpenClaw 代理错误")));
        break;
    }
  }

  private handleSocketClose(event: CloseEvent) {
    const wasReady = this.ready;
    const reason = event.reason || (wasReady ? "连接中断" : "连接失败");

    this.ready = false;
    this.connected = false;
    this.connecting = false;
    this.stopPing();
    this.socket = null;

    this.handlers.onDisconnect?.(reason);
    this.scheduleReconnect();
  }

  private scheduleReconnect() {
    if (!this.shouldReconnect) return;

    this.cancelReconnectTimer();

    this.reconnectAttempt += 1;
    const delayMs = getReconnectDelayMs(this.reconnectAttempt);
    this.handlers.onReconnect?.(delayMs, this.reconnectAttempt);

    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.shouldReconnect || this.connected || this.connecting) return;
      void this.openSocket();
    }, delayMs);
  }

  private cancelReconnectTimer() {
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private startPing() {
    this.stopPing();

    this.pingTimer = window.setInterval(() => {
      const socket = this.socket;
      if (!socket || socket.readyState !== WebSocket.OPEN) return;

      try {
        socket.send(JSON.stringify({ type: "ping" }));
      } catch {
        this.handlers.onError?.(new Error("发送 OpenClaw 心跳失败"));
      }
    }, PING_INTERVAL_MS);
  }

  private stopPing() {
    if (this.pingTimer !== null) {
      window.clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private teardownSocket() {
    const socket = this.socket;
    this.socket = null;
    this.connected = false;
    this.connecting = false;

    if (!socket) return;

    socket.onopen = null;
    socket.onmessage = null;
    socket.onerror = null;
    socket.onclose = null;

    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
      socket.close();
    }
  }

  private sendCommand<TParams extends object>(method: string, params: TParams) {
    const token = getToken();
    if (!token) {
      throw new Error("未登录，请重新登录");
    }

    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      throw new Error("OpenClaw 连接尚未建立");
    }

    const requestId = createOcId();
    const frame: WsReqFrame<TParams> = {
      type: "req",
      id: requestId,
      method,
      params,
    };

    socket.send(JSON.stringify(frame));
    return Promise.resolve(requestId);
  }

  private readonly handleVisibilityChange = () => {
    if (document.visibilityState !== "visible") return;
    this.triggerReconnectNow();
  };

  private readonly handleOnline = () => {
    this.triggerReconnectNow();
  };

  private triggerReconnectNow() {
    if (!this.shouldReconnect) return;

    const state = this.socket?.readyState;
    if (state === WebSocket.OPEN || state === WebSocket.CONNECTING) {
      return;
    }

    this.cancelReconnectTimer();
    void this.openSocket();
  }

  private bindLifecycleListeners() {
    if (this.lifecycleListenersBound) return;

    window.addEventListener("online", this.handleOnline);
    document.addEventListener("visibilitychange", this.handleVisibilityChange);
    this.lifecycleListenersBound = true;
  }

  private unbindLifecycleListeners() {
    if (!this.lifecycleListenersBound) return;

    window.removeEventListener("online", this.handleOnline);
    document.removeEventListener("visibilitychange", this.handleVisibilityChange);
    this.lifecycleListenersBound = false;
  }
}
