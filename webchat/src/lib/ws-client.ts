import { GATEWAY_URL, AUTH_TOKEN } from "./config";

export type ConnectionState = "disconnected" | "connecting" | "connected";

export interface WSFrame {
  seq?: number;
  event?: string;
  data?: Record<string, unknown>;
}

export interface WSClientOptions {
  onStateChange: (state: ConnectionState, message: string) => void;
  onFrame: (frame: WSFrame) => void;
}

export class WSClient {
  private ws: WebSocket | null = null;
  private connected = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private lastSeq = 0;
  private requestIdCounter = 0;
  private opts: WSClientOptions;
  private disposed = false;

  constructor(opts: WSClientOptions) {
    this.opts = opts;
  }

  connect() {
    if (this.disposed) return;
    this.fetchTicketAndConnect();
  }

  dispose() {
    this.disposed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
  }

  get isConnected() {
    return this.connected;
  }

  send(type: string, message?: string, extra?: Record<string, unknown>) {
    if (!this.ws || !this.connected) return;
    this.requestIdCounter++;
    const payload: Record<string, unknown> = {
      type,
      id: `web-${Date.now()}-${this.requestIdCounter}`,
      ...extra,
    };
    if (message !== undefined) payload.message = message;
    try {
      this.ws.send(JSON.stringify(payload));
    } catch {
      // swallow
    }
  }

  sendAbort() {
    this.send("abort");
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
          setTimeout(() => { location.href = "/login?redirect=/chat"; }, 1500);
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
    const wsBase = GATEWAY_URL.replace(/^http/, "ws");
    let wsUrl = `${wsBase}/ws/oc?ticket=${encodeURIComponent(ticket)}`;
    if (this.lastSeq > 0) wsUrl += `&lastSeq=${this.lastSeq}`;

    const ws = new WebSocket(wsUrl);
    this.ws = ws;

    ws.onopen = () => {
      this.connected = true;
      this.reconnectAttempt = 0;
      this.opts.onStateChange("connected", "已连接");
    };

    ws.onmessage = (evt) => {
      try {
        const frame = JSON.parse(evt.data) as WSFrame;
        if (frame.seq) this.lastSeq = frame.seq;
        this.opts.onFrame(frame);
      } catch {
        // ignore
      }
    };

    ws.onclose = () => {
      this.connected = false;
      this.ws = null;
      this.opts.onStateChange("disconnected", "连接断开");
      if (!this.disposed) this.scheduleReconnect();
    };

    ws.onerror = () => {};
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
