import { OpenClawClient, type ConnectionState, type OpenClawFrame } from "./openclaw-client";

export type WSFrame = OpenClawFrame;

export interface WSClientOptions {
  onStateChange: (state: ConnectionState, message: string) => void;
  onFrame: (frame: WSFrame) => void;
}

export class WSClient {
  private opts: WSClientOptions;
  private client: OpenClawClient;
  private lastSessionID: string | null = null;

  constructor(opts: WSClientOptions) {
    this.opts = opts;
    this.client = new OpenClawClient({
      onStateChange: opts.onStateChange,
      onFrame: opts.onFrame,
    });
  }

  connect() {
    this.client.connect();
  }

  dispose() {
    this.client.dispose();
  }

  get isConnected() {
    return this.client.isConnected;
  }

  send(type: string, message?: string, extra?: Record<string, unknown>) {
    if (!this.isConnected) return;

    if (type === "prompt") {
      const sessionID = typeof extra?.session_id === "string" ? extra.session_id : this.lastSessionID;
      if (!sessionID || !message) return;
      this.lastSessionID = sessionID;
      this.client
        .request("chat.send", {
          sessionKey: sessionID,
          message,
          idempotencyKey: this.makeID(),
        })
        .catch((err) => {
          this.emitError(err);
        });
      return;
    }

    if (type === "abort") {
      const sessionID = typeof extra?.session_id === "string" ? extra.session_id : this.lastSessionID;
      if (!sessionID) return;
      this.client
        .request("chat.abort", {
          sessionKey: sessionID,
        })
        .catch((err) => {
          this.emitError(err);
        });
      return;
    }

    const params: Record<string, unknown> = { ...extra };
    if (message !== undefined) params.message = message;
    this.client.request(type, params).catch((err) => {
      this.emitError(err);
    });
  }

  sendAbort(sessionID?: string) {
    if (sessionID) {
      this.send("abort", undefined, { session_id: sessionID });
      return;
    }
    this.send("abort");
  }

  private emitError(error: unknown) {
    this.opts.onFrame({
      type: "error",
      error: error instanceof Error ? error.message : String(error),
    });
  }

  private makeID(): string {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
    return `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  }
}
