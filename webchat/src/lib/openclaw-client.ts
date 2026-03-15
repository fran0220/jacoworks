import { AUTH_TOKEN, DEFAULT_OPENCLAW_SESSION_KEY, GATEWAY_URL, getOpenClawToken, getOpenClawWsPort } from "./config";

export type ConnectionState = "disconnected" | "connecting" | "connected";

export interface OpenClawEventFrame {
  type: "event";
  event: string;
  payload?: unknown;
  seq?: number;
}

export interface OpenClawResponseFrame {
  type: "res";
  id: string;
  ok: boolean;
  payload?: unknown;
  error?: {
    code?: string;
    message?: string;
    details?: unknown;
  };
}

export type OpenClawFrame = OpenClawEventFrame | OpenClawResponseFrame | Record<string, unknown>;

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

export interface OpenClawClientOptions {
  onStateChange: (state: ConnectionState, message: string) => void;
  onFrame: (frame: OpenClawFrame) => void;
}

const APP_PING_INTERVAL_MS = 25_000;

function makeID(prefix: string): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

/**
 * Direct browser → OpenClaw WS client.
 *
 * Connects via OpenResty `/ws/oc-direct/{port}` which proxies to the
 * user's OpenClaw container. Performs native OC challenge-response
 * handshake with the container_token injected by the Website.
 *
 * No gateway envelope framing — speaks raw OpenClaw protocol.
 */
export class OpenClawClient {
  private ws: WebSocket | null = null;
  private pending = new Map<string, PendingRequest>();
  private connected = false;
  private sessionKey = DEFAULT_OPENCLAW_SESSION_KEY;
  private disposed = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private handshakeInFlight = false;
  private handshakeDone = false;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private opts: OpenClawClientOptions;

  constructor(opts: OpenClawClientOptions) {
    this.opts = opts;
  }

  connect() {
    if (this.disposed) return;
    this.doConnect();
  }

  dispose() {
    this.disposed = true;
    this.connected = false;
    this.handshakeDone = false;
    this.handshakeInFlight = false;
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
    this.rejectPending(new Error("openclaw client stopped"));
  }

  get isConnected() {
    return this.connected;
  }

  setSessionKey(sessionKey: string) {
    const normalized = sessionKey.trim();
    if (!normalized) return;
    this.sessionKey = normalized;
  }

  getSessionKey() {
    return this.sessionKey;
  }

  sendChat(message: string): Promise<unknown> {
    return this.request("chat.send", {
      sessionKey: this.sessionKey,
      message,
      idempotencyKey: makeID("chat"),
    });
  }

  abortChat(): Promise<unknown> {
    return this.request("chat.abort", {
      sessionKey: this.sessionKey,
    });
  }

  request<T = unknown>(method: string, params?: unknown): Promise<T> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("openclaw not connected"));
    }
    // Allow "connect" method during handshake; all others require connected state
    if (method !== "connect" && !this.connected) {
      return Promise.reject(new Error("openclaw not connected"));
    }

    const id = makeID("req");
    const frame = { type: "req", id, method, params };
    const payload = JSON.stringify(frame);
    const promise = new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
      });
    });
    this.ws.send(payload);
    return promise;
  }

  /** Build the direct WS URL via OpenResty proxy */
  private buildWsUrl(): string | null {
    const port = getOpenClawWsPort();
    if (!port) return null;
    // GATEWAY_URL is "https://jacoapi.jingao.club" → ws base = "wss://jacoapi.jingao.club"
    const wsBase = GATEWAY_URL.replace(/^http/, "ws");
    return `${wsBase}/ws/oc-direct/${port}`;
  }

  /** Fallback: fetch ticket and connect via oc-gateway proxy (legacy path) */
  private buildLegacyWsUrl(ticket: string): string {
    const wsBase = GATEWAY_URL.replace(/^http/, "ws");
    return `${wsBase}/ws/oc?ticket=${encodeURIComponent(ticket)}&type=openclaw`;
  }

  private doConnect() {
    const directUrl = this.buildWsUrl();
    if (directUrl) {
      this.connectWebSocket(directUrl);
    } else {
      // No port injected (container not yet provisioned) — fall back to ticket flow
      this.fetchTicketAndConnect();
    }
  }

  private fetchTicketAndConnect() {
    this.opts.onStateChange("connecting", "正在连接...");

    fetch(`${GATEWAY_URL}/api/oc/ws-ticket`, {
      method: "POST",
      headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
    })
      .then((res) => {
        if (res.status === 401) {
          this.opts.onStateChange("disconnected", "登录已过期");
          setTimeout(() => {
            location.href = "/login?redirect=/chat";
          }, 1500);
          throw new Error("expired");
        }
        if (!res.ok) throw new Error(`获取凭证失败 (${res.status})`);
        return res.json();
      })
      .then((data: { ticket?: string }) => {
        if (!data.ticket) throw new Error("无效的 ticket");
        this.connectWebSocket(this.buildLegacyWsUrl(data.ticket));
      })
      .catch((err: Error) => {
        if (err.message === "expired") return;
        this.opts.onStateChange("disconnected", err.message);
        this.scheduleReconnect();
      });
  }

  private connectWebSocket(url: string) {
    this.opts.onStateChange("connecting", "正在建立连接...");
    this.handshakeDone = false;
    this.handshakeInFlight = false;

    const ws = new WebSocket(url);
    this.ws = ws;

    ws.onopen = () => {
      this.opts.onStateChange("connecting", "等待 OpenClaw 握手...");
      this.startHeartbeat();
    };

    ws.onmessage = (evt) => {
      try {
        const parsed = JSON.parse(evt.data) as Record<string, unknown>;
        this.handleFrame(parsed as OpenClawFrame);
      } catch {
        // ignore malformed frames
      }
    };

    ws.onclose = (ev) => {
      this.connected = false;
      this.handshakeDone = false;
      this.handshakeInFlight = false;
      this.ws = null;
      this.stopHeartbeat();
      this.rejectPending(new Error("connection closed"));

      if (ev.code === 1006 && !this.handshakeDone && this.reconnectAttempt >= 3) {
        this.opts.onStateChange("disconnected", "容器未就绪，正在刷新页面...");
        setTimeout(() => location.reload(), 1500);
        return;
      }

      this.opts.onStateChange("disconnected", "连接断开");
      if (!this.disposed) this.scheduleReconnect();
    };

    ws.onerror = () => {
      // close callback handles everything
    };
  }

  /** Handle raw OpenClaw protocol frames */
  private handleFrame(frame: OpenClawFrame) {
    const record = asRecord(frame);
    const frameType = typeof record.type === "string" ? record.type : "";

    // --- Legacy gateway envelope: {seq, event, data} ---
    // If we ended up on the legacy proxy path, unwrap envelope frames.
    if (typeof record.seq === "number" && typeof record.event === "string" && record.data !== undefined) {
      if (record.event === "proxy.ready") {
        if (!this.handshakeDone && !this.handshakeInFlight) {
          this.connected = true;
          this.handshakeDone = true;
          this.reconnectAttempt = 0;
          this.opts.onStateChange("connected", "已连接");
          this.opts.onFrame({ type: "proxy.ready" });
        }
        return;
      }
      if (record.event === "proxy.error") {
        const data = asRecord(record.data);
        const errMsg = typeof data.error === "string" ? data.error : "代理错误";
        this.opts.onStateChange("disconnected", errMsg);
        return;
      }
      // Unwrap inner data for legacy path
      this.handleFrame(asRecord(record.data) as OpenClawFrame);
      return;
    }

    // --- Direct OC protocol ---

    if (frameType === "pong") return; // heartbeat pong, ignore

    // connect.challenge → authenticate with container token
    if (frameType === "event" && record.event === "connect.challenge") {
      if (!this.handshakeDone && !this.handshakeInFlight) {
        this.handshakeInFlight = true;
        void this.sendConnect();
      }
      return;
    }

    // Response frames → resolve pending requests
    if (frameType === "res") {
      const id = typeof record.id === "string" ? record.id : "";
      const pending = this.pending.get(id);
      if (pending) {
        this.pending.delete(id);
        const ok = Boolean(record.ok);
        if (ok) pending.resolve(record.payload);
        else {
          const error = asRecord(record.error);
          pending.reject(new Error(String(error.message || "request failed")));
        }
      }
      this.opts.onFrame(frame);
      return;
    }

    // All other events → pass to UI
    this.opts.onFrame(frame);
  }

  private async sendConnect() {
    const token = getOpenClawToken();
    if (!token) {
      this.opts.onFrame({ type: "error", error: "缺少 OpenClaw token" });
      this.ws?.close(4008, "missing token");
      return;
    }

    try {
      await this.request("connect", {
        minProtocol: 3,
        maxProtocol: 3,
        client: {
          id: "openclaw-control-ui",
          version: "webchat-1.0.0",
          platform: navigator.platform || "web",
          mode: "ui",
        },
        role: "operator",
        scopes: ["operator.admin", "operator.read", "operator.write", "operator.pairing", "operator.approvals", "operator.talk.secrets"],
        caps: ["tool-events"],
        auth: { token },
      });

      this.connected = true;
      this.handshakeDone = true;
      this.handshakeInFlight = false;
      this.reconnectAttempt = 0;
      this.opts.onStateChange("connected", "已连接");
      this.opts.onFrame({ type: "proxy.ready" });
    } catch (err) {
      this.handshakeInFlight = false;
      this.connected = false;
      this.opts.onFrame({ type: "error", error: String(err) });
      this.ws?.close(4008, "connect failed");
    }
  }

  private startHeartbeat() {
    // In direct mode, OpenClaw manages its own connection timeout.
    // Only send heartbeats if connected via legacy gateway proxy.
    // The native OC protocol doesn't accept {type:"ping"} frames.
    this.stopHeartbeat();
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private rejectPending(error: Error) {
    for (const [, pending] of this.pending) {
      pending.reject(error);
    }
    this.pending.clear();
  }

  private scheduleReconnect() {
    if (this.reconnectTimer || this.disposed) return;
    this.reconnectAttempt++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempt - 1), 15000);
    const total = Math.round(delay + delay * 0.2 * Math.random());
    this.opts.onStateChange("connecting", `${Math.ceil(total / 1000)}秒后重连...`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.doConnect();
    }, total);
  }
}
