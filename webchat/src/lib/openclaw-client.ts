import { AUTH_TOKEN, DEFAULT_OPENCLAW_SESSION_KEY, GATEWAY_URL, getOpenClawToken } from "./config";

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

/** Gateway envelope frame wrapping upstream messages */
interface GatewayEnvelopeFrame {
  seq: number;
  event: string;
  data: Record<string, unknown>;
}

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
  private lastSeq = 0;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private opts: OpenClawClientOptions;

  constructor(opts: OpenClawClientOptions) {
    this.opts = opts;
  }

  connect() {
    if (this.disposed) return;
    this.fetchTicketAndConnect();
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
      return Promise.reject(new Error("gateway not connected"));
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
        this.connectWebSocket(data.ticket);
      })
      .catch((err: Error) => {
        if (err.message === "expired") return;
        this.opts.onStateChange("disconnected", err.message);
        this.scheduleReconnect();
      });
  }

  private connectWebSocket(ticket: string) {
    this.opts.onStateChange("connecting", "正在建立连接...");
    this.handshakeDone = false;
    this.handshakeInFlight = false;

    const wsBase = GATEWAY_URL.replace(/^http/, "ws");
    let wsUrl = `${wsBase}/ws/oc?ticket=${encodeURIComponent(ticket)}&type=openclaw`;
    if (this.lastSeq > 0) {
      wsUrl += `&lastSeq=${this.lastSeq}`;
    }
    const ws = new WebSocket(wsUrl);
    this.ws = ws;

    ws.onopen = () => {
      this.opts.onStateChange("connecting", "等待 OpenClaw 握手...");
      this.startHeartbeat();
    };

    ws.onmessage = (evt) => {
      try {
        const parsed = JSON.parse(evt.data) as Record<string, unknown>;
        this.handleIncomingMessage(parsed);
      } catch {
        // ignore malformed frames
      }
    };

    ws.onclose = () => {
      this.connected = false;
      this.handshakeDone = false;
      this.handshakeInFlight = false;
      this.ws = null;
      this.stopHeartbeat();
      this.rejectPending(new Error("gateway closed"));
      this.opts.onStateChange("disconnected", "连接断开");
      if (!this.disposed) this.scheduleReconnect();
    };

    ws.onerror = () => {
      // close callback handles reconnect/error state
    };
  }

  /** Handle incoming messages — unwrap gateway envelope if present */
  private handleIncomingMessage(raw: Record<string, unknown>) {
    // Check if this is a gateway envelope frame: {seq, event, data}
    if (typeof raw.seq === "number" && typeof raw.event === "string" && raw.data !== undefined) {
      const envelope = raw as unknown as GatewayEnvelopeFrame;
      if (envelope.seq > 0) {
        this.lastSeq = envelope.seq;
      }

      // Handle proxy-level events from the envelope
      if (envelope.event === "proxy.ready") {
        // Channel connected — the OC challenge will follow as a "message" event
        return;
      }
      if (envelope.event === "proxy.error") {
        const errMsg = typeof envelope.data?.error === "string" ? envelope.data.error : "代理错误";
        this.opts.onStateChange("disconnected", errMsg);
        return;
      }

      // Unwrap: pass the inner data to OC frame handler
      this.handleFrame(envelope.data as OpenClawFrame);
      return;
    }

    // Not an envelope — handle as direct OC frame (pong, legacy, etc.)
    const frameType = typeof raw.type === "string" ? raw.type : "";
    if (frameType === "pong") return; // Heartbeat pong, ignore

    this.handleFrame(raw as OpenClawFrame);
  }

  private handleFrame(frame: OpenClawFrame) {
    const record = asRecord(frame);
    const frameType = typeof record.type === "string" ? record.type : "";

    if (frameType === "event" && record.event === "connect.challenge") {
      if (!this.handshakeDone && !this.handshakeInFlight) {
        this.handshakeInFlight = true;
        void this.sendConnect();
      }
      this.opts.onFrame(frame);
      return;
    }

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
          id: "gateway-client",
          version: "webchat-1.0.0",
          platform: navigator.platform || "web",
          mode: "backend",
        },
        role: "operator",
        scopes: ["operator.admin"],
        caps: ["tool-events"],
        auth: {
          token,
        },
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
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        try {
          this.ws.send(JSON.stringify({ type: "ping" }));
        } catch {
          // connection error will be caught by onclose
        }
      }
    }, APP_PING_INTERVAL_MS);
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
      this.fetchTicketAndConnect();
    }, total);
  }
}
