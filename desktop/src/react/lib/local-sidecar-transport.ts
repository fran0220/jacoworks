import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { AgentRpcEvent } from "./agent";
import type { AgentTransport } from "./agent-transport";

export interface SidecarConfig {
  agentDir: string;
  envVars: Record<string, string>;
}

interface StartAgentResponse {
  running: boolean;
  transport: string;
}

export class LocalSidecarTransport implements AgentTransport {
  private ready = false;
  private connecting = false;
  private messageHandler: ((packet: AgentRpcEvent) => void) | null = null;
  private readyHandler: (() => void) | null = null;
  private errorHandler: ((error: Error) => void) | null = null;
  private unlisten: UnlistenFn | null = null;

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

      if (payload.type === "ready") {
        this.markReady();
      } else if (payload.type === "error" && typeof payload.error === "string") {
        this.errorHandler?.(new Error(payload.error));
      }

      this.messageHandler?.(payload);
    });

    try {
      await invoke<StartAgentResponse>("start_agent", {
        agentDir: this.config.agentDir,
        envVars: this.config.envVars,
      });
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
    void this.detachListener();
    invoke("stop_agent").catch(() => {});
  }

  send(command: Record<string, unknown>): void {
    invoke("agent_rpc_send", { command }).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      this.errorHandler?.(new Error(message));
    });
  }

  onMessage(handler: ((packet: AgentRpcEvent) => void) | null): void {
    this.messageHandler = handler;
  }

  onReady(handler: (() => void) | null): void {
    this.readyHandler = handler;
  }

  onError(handler: ((error: Error) => void) | null): void {
    this.errorHandler = handler;
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
