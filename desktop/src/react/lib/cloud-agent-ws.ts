import { getToken } from "./auth";
import { GATEWAY_URL } from "./config";
import type { AgentRpcEvent } from "./agent";

const RECONNECT_BASE_DELAY_MS = 1_000;
const RECONNECT_MAX_DELAY_MS = 15_000;
const RECONNECT_JITTER_RATIO = 0.2;
const APP_PING_INTERVAL_MS = 25_000;
const APP_PONG_TIMEOUT_MS = 5_000;
const APP_PONG_MISSED_LIMIT = 2;
const STABLE_CONNECTION_RESET_MS = 60_000;
const DEFAULT_MAX_RECONNECT_ATTEMPTS = 20;

export interface CloudAgentWSHandlers {
  onReady?: () => void;
  onMessage?: (packet: AgentRpcEvent) => void;
  onFileRequest?: (request: Record<string, unknown>) => void;
  onDisconnect?: (reason: string) => void;
  onError?: (error: Error) => void;
  onReconnect?: (delayMs: number, attempt: number) => void;
  onActivity?: (timestamp: number) => void;
  onReconnectExhausted?: (error: Error) => void;
}

export interface CloudAgentWSOptions {
  maxReconnectAttempts?: number;
}

function buildWebSocketUrl(token: string): string {
  const base = GATEWAY_URL.replace(/\/$/, "");
  const url = new URL(base);

  if (url.protocol === "https:") {
    url.protocol = "wss:";
  } else if (url.protocol === "http:") {
    url.protocol = "ws:";
  } else if (url.protocol !== "ws:" && url.protocol !== "wss:") {
    throw new Error(`不支持的网关协议: ${url.protocol}`);
  }

  url.pathname = "/ws/agent";
  url.search = "";
  url.searchParams.set("token", token);
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

export class CloudAgentWS {
  private socket: WebSocket | null = null;
  private connected = false;
  private connecting = false;
  private shouldReconnect = false;
  private ready = false;
  private reconnectAttempt = 0;
  private reconnectTimer: number | null = null;
  private connectRunId = 0;
  private lifecycleListenersBound = false;
  private appPingTimer: number | null = null;
  private pongTimeoutTimer: number | null = null;
  private stableConnectionTimer: number | null = null;
  private waitingForPong = false;
  private missedPongCount = 0;
  private lastPongAtTs = 0;
  private lastActivityAtTs = 0;
  private readonly maxReconnectAttempts: number;

  constructor(
    private handlers: CloudAgentWSHandlers = {},
    options: CloudAgentWSOptions = {},
  ) {
    this.maxReconnectAttempts = Math.max(1, options.maxReconnectAttempts ?? DEFAULT_MAX_RECONNECT_ATTEMPTS);
  }

  get isReady() {
    return this.ready;
  }

  get lastPongAt() {
    return this.lastPongAtTs;
  }

  connect() {
    this.shouldReconnect = true;
    this.bindLifecycleListeners();

    if (this.connected || this.connecting) {
      return;
    }

    this.openSocket();
  }

  close() {
    this.shouldReconnect = false;
    this.ready = false;
    this.reconnectAttempt = 0;
    this.missedPongCount = 0;
    this.waitingForPong = false;

    this.cancelReconnectTimer();
    this.cancelPingTimer();
    this.cancelPongTimeout();
    this.cancelStableConnectionTimer();
    this.unbindLifecycleListeners();

    this.connectRunId += 1;
    this.teardownSocket();
  }

  send(command: Record<string, unknown>): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("云端连接尚未建立");
    }
    this.socket.send(JSON.stringify(command));
  }

  private openSocket() {
    if (this.connected || this.connecting) return;

    const token = getToken();
    if (!token) {
      this.handlers.onError?.(new Error("未找到登录 token，请重新登录"));
      return;
    }

    this.connecting = true;
    const runId = ++this.connectRunId;

    try {
      const wsUrl = buildWebSocketUrl(token);
      const socket = new WebSocket(wsUrl);
      this.socket = socket;

      socket.onopen = () => {
        if (!this.isActiveSocket(socket, runId)) return;
        this.connected = true;
        this.connecting = false;
        this.startPingLoop();
      };

      socket.onmessage = (event) => {
        if (!this.isActiveSocket(socket, runId)) return;
        this.handleIncomingData(event.data);
      };

      socket.onerror = () => {
        if (!this.isActiveSocket(socket, runId)) return;
        this.handlers.onError?.(new Error("云端 Agent WebSocket 连接错误"));
      };

      socket.onclose = (event) => {
        if (!this.isActiveSocket(socket, runId)) return;
        this.handleSocketClose(event);
      };
    } catch (error) {
      if (runId !== this.connectRunId) return;

      this.connected = false;
      this.connecting = false;

      if (!this.shouldReconnect) return;

      const message = error instanceof Error ? error.message : String(error);
      this.handlers.onError?.(new Error(message));
      this.scheduleReconnect();
    }
  }

  private isActiveSocket(socket: WebSocket, runId: number) {
    return this.socket === socket && runId === this.connectRunId;
  }

  private handleIncomingData(data: string | Blob | ArrayBuffer) {
    this.markActivity();

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
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }

    const type = typeof message.type === "string" ? message.type : "";

    if (type === "pong") {
      this.lastPongAtTs = Date.now();
      return;
    }

    if (type === "proxy.ready") {
      const recovered = this.reconnectAttempt > 0;
      this.ready = true;
      this.startPingLoop();
      this.scheduleStableConnectionReset();
      this.handlers.onReady?.();
      if (recovered) {
        this.handlers.onMessage?.({ type: "proxy.reconnected" } as AgentRpcEvent);
      }
      return;
    }

    if (type === "proxy.error") {
      const errMsg = typeof message.error === "string" ? message.error : "云端代理错误";
      this.handlers.onError?.(new Error(errMsg));
      return;
    }

    // Remote filesystem requests from container
    if (type.startsWith("fs.") && !type.endsWith(".result")) {
      this.handlers.onFileRequest?.(message);
      return;
    }

    this.handlers.onMessage?.(message as AgentRpcEvent);
  }

  private handleSocketClose(event: CloseEvent) {
    const wasReady = this.ready;
    const reason = event.reason || (wasReady ? "连接中断" : "连接失败");

    this.cancelPingTimer();
    this.cancelPongTimeout();
    this.cancelStableConnectionTimer();
    this.waitingForPong = false;

    this.ready = false;
    this.connected = false;
    this.connecting = false;
    this.socket = null;

    this.handlers.onDisconnect?.(reason);
    this.scheduleReconnect();
  }

  private scheduleReconnect() {
    if (!this.shouldReconnect) return;

    this.cancelReconnectTimer();

    if (this.reconnectAttempt >= this.maxReconnectAttempts) {
      this.shouldReconnect = false;
      const error = new Error(`云端连接重试次数已达上限（${this.maxReconnectAttempts} 次）`);
      this.handlers.onError?.(error);
      this.handlers.onReconnectExhausted?.(error);
      return;
    }

    this.reconnectAttempt += 1;
    const delayMs = getReconnectDelayMs(this.reconnectAttempt);
    this.handlers.onReconnect?.(delayMs, this.reconnectAttempt);

    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.shouldReconnect || this.connected || this.connecting) return;
      this.openSocket();
    }, delayMs);
  }

  private cancelReconnectTimer() {
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private scheduleStableConnectionReset() {
    this.cancelStableConnectionTimer();
    this.stableConnectionTimer = window.setTimeout(() => {
      this.stableConnectionTimer = null;
      this.reconnectAttempt = 0;
    }, STABLE_CONNECTION_RESET_MS);
  }

  private cancelStableConnectionTimer() {
    if (this.stableConnectionTimer !== null) {
      window.clearTimeout(this.stableConnectionTimer);
      this.stableConnectionTimer = null;
    }
  }

  private startPingLoop() {
    this.cancelPingTimer();
    this.cancelPongTimeout();
    this.waitingForPong = false;
    this.missedPongCount = 0;

    this.appPingTimer = window.setInterval(() => {
      this.sendPing();
    }, APP_PING_INTERVAL_MS);
  }

  private cancelPingTimer() {
    if (this.appPingTimer !== null) {
      window.clearInterval(this.appPingTimer);
      this.appPingTimer = null;
    }
  }

  private sendPing() {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    if (!this.shouldReconnect || !this.connected || this.connecting) return;
    if (this.reconnectAttempt > 0 && !this.ready) return;
    if (this.waitingForPong) return;

    try {
      this.socket.send(JSON.stringify({ type: "ping" }));
      this.waitingForPong = true;
      this.cancelPongTimeout();
      this.pongTimeoutTimer = window.setTimeout(() => {
        if (!this.waitingForPong) return;
        this.waitingForPong = false;
        this.missedPongCount += 1;

        if (this.missedPongCount >= APP_PONG_MISSED_LIMIT) {
          this.handlers.onError?.(new Error("云端连接心跳超时，正在重连"));
          this.forceReconnect("heartbeat timeout");
        }
      }, APP_PONG_TIMEOUT_MS);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.handlers.onError?.(new Error(message));
      this.forceReconnect("ping failed");
    }
  }

  private cancelPongTimeout() {
    if (this.pongTimeoutTimer !== null) {
      window.clearTimeout(this.pongTimeoutTimer);
      this.pongTimeoutTimer = null;
    }
  }

  private markActivity() {
    const now = Date.now();
    this.lastActivityAtTs = now;
    this.handlers.onActivity?.(now);
    this.missedPongCount = 0;
    this.waitingForPong = false;
    this.cancelPongTimeout();
  }

  private forceReconnect(reason: string) {
    const socket = this.socket;
    if (!socket) return;
    if (socket.readyState !== WebSocket.OPEN && socket.readyState !== WebSocket.CONNECTING) return;

    try {
      socket.close(4000, reason);
    } catch {
      this.connecting = false;
      this.connected = false;
      this.ready = false;
      this.socket = null;
      this.scheduleReconnect();
    }
  }

  private teardownSocket() {
    const socket = this.socket;
    this.socket = null;
    this.connected = false;
    this.connecting = false;
    this.ready = false;

    this.cancelPingTimer();
    this.cancelPongTimeout();
    this.cancelStableConnectionTimer();
    this.waitingForPong = false;

    if (!socket) return;

    socket.onopen = null;
    socket.onmessage = null;
    socket.onerror = null;
    socket.onclose = null;

    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
      socket.close();
    }
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
    this.openSocket();
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
