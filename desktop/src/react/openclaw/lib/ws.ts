import { getToken } from "../../lib/auth";
import { GATEWAY_URL, OPENCLAW_WS_URL } from "../../lib/config";
import {
  createOcId,
  type OcChatAbortParams,
  type OcChatSendParams,
  type OcEvent,
  type OcFrame,
  type OcPingFrame,
  type OcReq,
  type OcRes,
} from "../types";

const HEARTBEAT_MS = 10_000;
const RECONNECT_BASE_DELAY_MS = 800;
const RECONNECT_MAX_DELAY_MS = 15_000;

export interface OpenClawWSHandlers {
  onReady?: () => void;
  onEvent?: (event: OcEvent) => void;
  onResponse?: (response: OcRes) => void;
  onDisconnect?: (reason: string) => void;
  onError?: (error: Error) => void;
  onReconnect?: (delayMs: number, attempt: number) => void;
}

function toWsGatewayUrl(httpGatewayUrl: string) {
  return httpGatewayUrl.replace(/^http/i, "ws");
}

function buildOpenClawWsUrl(token: string) {
  const base = (OPENCLAW_WS_URL || `${toWsGatewayUrl(GATEWAY_URL)}/ws/openclaw`).trim();
  const normalizedBase = base.replace(/\/$/, "");
  const separator = normalizedBase.includes("?") ? "&" : "?";
  return `${normalizedBase}${separator}token=${encodeURIComponent(token)}`;
}

function parseFrame(raw: string): OcFrame | null {
  try {
    const parsed = JSON.parse(raw) as OcFrame;
    if (!parsed || typeof parsed !== "object" || !("type" in parsed)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export class OpenClawWS {
  private socket: WebSocket | null = null;
  private shouldReconnect = false;
  private ready = false;
  private reconnectAttempt = 0;
  private heartbeatTimer: number | null = null;
  private reconnectTimer: number | null = null;

  constructor(private handlers: OpenClawWSHandlers = {}) {}

  get isReady() {
    return this.ready;
  }

  connect() {
    this.shouldReconnect = true;
    this.clearReconnectTimer();

    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.openSocket();
  }

  close() {
    this.shouldReconnect = false;
    this.ready = false;
    this.clearHeartbeat();
    this.clearReconnectTimer();
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      this.socket.close(1000, "client close");
    }
    this.socket = null;
  }

  request<TParams extends object>(method: string, params: TParams) {
    const requestId = createOcId();
    const frame: OcReq<TParams> = {
      type: "req",
      id: requestId,
      method,
      params,
    };
    this.send(frame);
    return requestId;
  }

  sendChat(params: { sessionKey: string; message: string; idempotencyKey?: string }) {
    const payload: OcChatSendParams = {
      sessionKey: params.sessionKey,
      message: params.message,
      deliver: true,
      idempotencyKey: params.idempotencyKey ?? createOcId(),
    };
    return this.request("chat.send", payload);
  }

  abortChat(sessionKey: string) {
    const payload: OcChatAbortParams = { sessionKey };
    return this.request("chat.abort", payload);
  }

  private send(frame: OcReq<unknown> | OcPingFrame) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("OpenClaw WebSocket 未连接");
    }
    this.socket.send(JSON.stringify(frame));
  }

  private openSocket() {
    const token = getToken();
    if (!token) {
      this.handlers.onError?.(new Error("未找到登录 token，请重新登录"));
      return;
    }

    const wsUrl = buildOpenClawWsUrl(token);
    let socket: WebSocket;
    try {
      socket = new WebSocket(wsUrl);
    } catch {
      const secureHint =
        wsUrl.startsWith("ws://") && typeof window !== "undefined" && window.isSecureContext
          ? "当前运行环境拦截了 ws:// 连接，请配置 VITE_OPENCLAW_WS_URL 为 wss:// 地址"
          : "请检查网关地址和网络连通性";
      this.handlers.onError?.(new Error(`OpenClaw WebSocket 初始化失败：${secureHint}`));
      return;
    }
    this.socket = socket;

    socket.onopen = () => {
      this.startHeartbeat();
    };

    socket.onmessage = (event) => {
      if (typeof event.data !== "string") return;
      const frame = parseFrame(event.data);
      if (!frame) return;

      if (frame.type === "proxy.ready") {
        this.ready = true;
        this.reconnectAttempt = 0;
        this.handlers.onReady?.();
        return;
      }

      if (frame.type === "pong") {
        return;
      }

      if (frame.type === "proxy.error") {
        this.handlers.onError?.(new Error(frame.error || "OpenClaw 代理错误"));
        return;
      }

      if (frame.type === "event") {
        this.handlers.onEvent?.(frame);
        return;
      }

      if (frame.type === "res") {
        this.handlers.onResponse?.(frame);
      }
    };

    socket.onerror = () => {
      this.handlers.onError?.(new Error("OpenClaw WebSocket 连接异常"));
    };

    socket.onclose = (event) => {
      this.clearHeartbeat();
      this.ready = false;
      this.socket = null;

      const reason = event.reason || `code=${event.code}`;
      this.handlers.onDisconnect?.(reason);

      if (this.shouldReconnect) {
        this.scheduleReconnect();
      }
    };
  }

  private startHeartbeat() {
    this.clearHeartbeat();
    // Send one ping immediately after connect so strict upstream idle timers do not cut us off.
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      const pingFrame: OcPingFrame = { type: "ping" };
      this.socket.send(JSON.stringify(pingFrame));
    }
    this.heartbeatTimer = window.setInterval(() => {
      if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
      const pingFrame: OcPingFrame = { type: "ping" };
      this.socket.send(JSON.stringify(pingFrame));
    }, HEARTBEAT_MS);
  }

  private scheduleReconnect() {
    this.clearReconnectTimer();
    const attempt = this.reconnectAttempt + 1;
    const delay = Math.min(RECONNECT_BASE_DELAY_MS * 2 ** this.reconnectAttempt, RECONNECT_MAX_DELAY_MS);
    this.reconnectAttempt = attempt;
    this.handlers.onReconnect?.(delay, attempt);
    this.reconnectTimer = window.setTimeout(() => {
      this.openSocket();
    }, delay);
  }

  private clearHeartbeat() {
    if (this.heartbeatTimer !== null) {
      window.clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private clearReconnectTimer() {
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}
