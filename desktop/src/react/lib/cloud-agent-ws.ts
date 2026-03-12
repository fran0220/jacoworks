import { getToken } from "./auth";
import { GATEWAY_URL } from "./config";
import type { AgentRpcEvent } from "./agent";

const RECONNECT_BASE_DELAY_MS = 1_000;
const RECONNECT_MAX_DELAY_MS = 15_000;
const RECONNECT_SLOW_DELAY_MS = 30_000;
const RECONNECT_JITTER_RATIO = 0.2;
const APP_PING_INTERVAL_MS = 25_000;
const APP_PONG_TIMEOUT_MS = 5_000;
const APP_PONG_MISSED_LIMIT = 2;
const STABLE_CONNECTION_RESET_MS = 60_000;
/** After this many fast retries, switch to slow interval */
const FAST_RECONNECT_LIMIT = 20;

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

/** Envelope frame from the gateway WS bridge */
interface EnvelopeFrame {
  seq: number;
  event: string;
  data: Record<string, unknown>;
}

function buildWebSocketUrl(ticket: string, lastSeq: number): string {
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
  if (lastSeq > 0) {
    url.searchParams.set("lastSeq", String(lastSeq));
  }
  return url.toString();
}

function getReconnectDelayMs(attempt: number) {
  if (attempt > FAST_RECONNECT_LIMIT) {
    // Slow retry mode: 30s with jitter
    const jitterSpan = RECONNECT_SLOW_DELAY_MS * RECONNECT_JITTER_RATIO;
    return Math.round(RECONNECT_SLOW_DELAY_MS - jitterSpan + Math.random() * jitterSpan * 2);
  }
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
  private lastSeq = 0;
  private pendingQueue: Record<string, unknown>[] = [];

  constructor(
    private handlers: CloudAgentWSHandlers = {},
    _options: CloudAgentWSOptions = {},
  ) {}

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

    void this.openSocket();
  }

  close() {
    this.shouldReconnect = false;
    this.ready = false;
    this.reconnectAttempt = 0;
    this.missedPongCount = 0;
    this.waitingForPong = false;
    this.pendingQueue = [];

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
      // Queue for later delivery instead of throwing
      this.pendingQueue.push(command);
      return;
    }
    this.socket.send(JSON.stringify(command));
  }

  private async fetchTicket(): Promise<string | null> {
    const token = getToken();
    if (!token) {
      this.handlers.onError?.(new Error("未找到登录 token，请重新登录"));
      return null;
    }

    try {
      const res = await fetch(`${GATEWAY_URL}/api/agent/ws-ticket`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.status === 401) {
        this.handlers.onError?.(new Error("登录已过期，请重新登录"));
        return null;
      }
      if (!res.ok) {
        throw new Error(`获取凭证失败 (${res.status})`);
      }

      const data = (await res.json()) as { ticket?: string };
      if (!data.ticket) throw new Error("无效的 ticket");
      return data.ticket;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.handlers.onError?.(new Error(message));
      return null;
    }
  }

  private async openSocket() {
    if (this.connected || this.connecting) return;

    this.connecting = true;
    const runId = ++this.connectRunId;

    try {
      const ticket = await this.fetchTicket();
      if (runId !== this.connectRunId) return;

      if (!ticket) {
        this.connecting = false;
        if (this.shouldReconnect) {
          this.scheduleReconnect();
        }
        return;
      }

      const wsUrl = buildWebSocketUrl(ticket, this.lastSeq);
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
    let frame: Record<string, unknown>;
    try {
      frame = JSON.parse(raw);
    } catch {
      return;
    }

    // Unwrap envelope frame: {seq, event, data}
    if (typeof frame.seq === "number" && typeof frame.event === "string" && frame.data !== undefined) {
      const envelope = frame as unknown as EnvelopeFrame;
      if (envelope.seq > 0) {
        this.lastSeq = envelope.seq;
      }

      // Handle envelope-level events
      const event = envelope.event;
      const innerData = envelope.data;

      if (event === "proxy.ready") {
        this.handleProxyReady();
        return;
      }
      if (event === "proxy.error") {
        const errMsg = typeof innerData?.error === "string" ? innerData.error : "云端代理错误";
        this.handlers.onError?.(new Error(errMsg));
        return;
      }
      if (event === "proxy.gap") {
        // Buffer overflow — some events were lost
        this.handlers.onError?.(new Error("部分事件丢失，建议刷新"));
        return;
      }

      // Dispatch inner data as the actual message
      this.dispatchMessage(innerData);
      return;
    }

    // Legacy: direct message without envelope (during transition / pong responses)
    const type = typeof frame.type === "string" ? frame.type : "";

    if (type === "pong") {
      this.lastPongAtTs = Date.now();
      return;
    }

    if (type === "proxy.ready") {
      this.handleProxyReady();
      return;
    }

    if (type === "proxy.error") {
      const errMsg = typeof frame.error === "string" ? frame.error : "云端代理错误";
      this.handlers.onError?.(new Error(errMsg));
      return;
    }

    this.dispatchMessage(frame);
  }

  private handleProxyReady() {
    const recovered = this.reconnectAttempt > 0;
    this.ready = true;
    this.startPingLoop();
    this.scheduleStableConnectionReset();
    this.handlers.onReady?.();
    if (recovered) {
      this.handlers.onMessage?.({ type: "proxy.reconnected" } as AgentRpcEvent);
    }
    // Flush pending queue
    this.flushPendingQueue();
  }

  private flushPendingQueue() {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    const queue = this.pendingQueue;
    this.pendingQueue = [];
    for (const cmd of queue) {
      try {
        this.socket.send(JSON.stringify(cmd));
      } catch {
        // Re-queue on failure
        this.pendingQueue.push(cmd);
        break;
      }
    }
  }

  private dispatchMessage(message: Record<string, unknown>) {
    const type = typeof message.type === "string" ? message.type : "";

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

    // No hard upper limit — switch to slow retry after FAST_RECONNECT_LIMIT
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
