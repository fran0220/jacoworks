import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { AgentRpcEvent } from "./agent";
import type { AgentSessionOptions, AgentTransport } from "./agent-transport";

export interface SidecarConfig {
  agentDir: string;
  envVars: Record<string, string>;
}

export class LocalSidecarTransport implements AgentTransport {
  private ready = false;
  private connecting = false;
  private messageHandlers = new Set<(packet: AgentRpcEvent) => void>();
  private readyHandler: (() => void) | null = null;
  private errorHandler: ((error: Error) => void) | null = null;
  private unlisten: UnlistenFn | null = null;
  private ensuredSessions = new Set<string>();

  constructor(private readonly config: SidecarConfig) {}

  get isReady() {
    return this.ready;
  }

  async connect(): Promise<void> {
    if (this.ready || this.connecting) return;
    this.connecting = true;
    this.ready = false;

    await this.detachListener();
    this.unlisten = await listen<AgentRpcEvent>("agent-rpc-event", (event) => {
      const payload = event.payload;
      if (!payload || typeof payload !== "object") return;

      if (payload.type === "session") {
        this.markReady();
      } else if (payload.type === "error" && typeof payload.error === "string") {
        this.errorHandler?.(new Error(payload.error));
      }

      this.dispatch(payload);
    });

    try {
      this.markReady();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.errorHandler?.(new Error(message));
      await this.detachListener();
      this.ready = false;
      throw error;
    } finally {
      this.connecting = false;
    }
  }

  close(): void {
    this.ready = false;
    this.connecting = false;
    const sessions = [...this.ensuredSessions];
    this.ensuredSessions.clear();
    void this.detachListener();
    for (const sessionId of sessions) {
      invoke("stop_pi_session", { sessionId }).catch(() => {});
    }
  }

  async ensureSession(sessionId: string, options?: AgentSessionOptions): Promise<void> {
    try {
      await invoke("ensure_pi_session", {
        sessionId,
        agentDir: this.config.agentDir,
        envVars: this.config.envVars,
        userId: options?.userId,
        model: options?.model,
        workspace: options?.workspace,
        restricted: options?.restricted,
        streamingBehavior: options?.streamingBehavior,
        thinkingLevel: options?.thinkingLevel,
        anonymous: options?.anonymous,
      });
      this.ensuredSessions.add(sessionId);
      this.markReady();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.errorHandler?.(new Error(message));
      throw error;
    }
  }

  async sendMessage(sessionId: string, message: string): Promise<void> {
    try {
      await invoke("agent_rpc_send", { sessionId, message });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.errorHandler?.(new Error(msg));
      throw error;
    }
  }

  async abortSession(sessionId: string): Promise<void> {
    try {
      await invoke("abort_pi_session", { sessionId });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.errorHandler?.(new Error(msg));
      throw error;
    }
  }

  onMessage(handler: ((packet: AgentRpcEvent) => void) | null): void {
    // Legacy compat: no-op, use subscribe() instead
  }

  subscribe(handler: (packet: AgentRpcEvent) => void): () => void {
    this.messageHandlers.add(handler);
    return () => { this.messageHandlers.delete(handler); };
  }

  onReady(handler: (() => void) | null): void {
    this.readyHandler = handler;
  }

  onError(handler: ((error: Error) => void) | null): void {
    this.errorHandler = handler;
  }

  private dispatch(payload: AgentRpcEvent) {
    for (const handler of this.messageHandlers) handler(payload);
  }

  private markReady() {
    if (this.ready) return;
    this.ready = true;
    this.readyHandler?.();
  }

  private async detachListener() {
    if (!this.unlisten) return;
    this.unlisten();
    this.unlisten = null;
  }
}
