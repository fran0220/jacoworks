import { OpenClawClient, type ConnectionState, type OpenClawFrame } from "./openclaw-client";

export type WSFrame = OpenClawFrame;

export interface WSClientOptions {
  onStateChange: (state: ConnectionState, message: string) => void;
  onFrame: (frame: WSFrame) => void;
  sessionKey?: string;
}

export class WSClient {
  private opts: WSClientOptions;
  private client: OpenClawClient;

  constructor(opts: WSClientOptions) {
    this.opts = opts;
    this.client = new OpenClawClient({
      onStateChange: opts.onStateChange,
      onFrame: opts.onFrame,
    });
    if (opts.sessionKey) {
      this.client.setSessionKey(opts.sessionKey);
    }
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

  setSessionKey(sessionKey: string) {
    this.client.setSessionKey(sessionKey);
  }

  getSessionKey() {
    return this.client.getSessionKey();
  }

  send(type: string, message?: string, extra?: Record<string, unknown>) {
    if (!this.isConnected) return;

    if (type === "prompt") {
      if (!message) return;
      this.client.sendChat(message).catch((err) => {
        this.emitError(err);
      });
      return;
    }

    if (type === "abort") {
      this.client.abortChat().catch((err) => {
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

  sendAbort() {
    this.send("abort");
  }

  private emitError(error: unknown) {
    this.opts.onFrame({
      type: "error",
      error: error instanceof Error ? error.message : String(error),
    });
  }

}
