import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { AgentRpcEvent } from "./agent";
import type { AgentTransport } from "./agent-transport";
import type { SkillDefinition } from "./skills";

export interface SidecarConfig {
  agentDir: string;
  envVars: Record<string, string>;
}

interface StartAgentResponse {
  running: boolean;
  transport: string;
}

/** Skill info as emitted by sidecar `ready` event. */
interface SidecarSkillInfo {
  id: string;
  name: string;
  description: string;
  group?: string;
  source: "builtin" | "user";
  editable: boolean;
}

export class LocalSidecarTransport implements AgentTransport {
  private ready = false;
  private connecting = false;
  private messageHandlers = new Set<(packet: AgentRpcEvent) => void>();
  private readyHandler: (() => void) | null = null;
  private errorHandler: ((error: Error) => void) | null = null;
  private unlisten: UnlistenFn | null = null;

  /** Skills reported by sidecar in its `ready` event (actual LLM-visible skills). */
  private _loadedSkills: SkillDefinition[] = [];

  constructor(private readonly config: SidecarConfig) {}

  get isReady() {
    return this.ready;
  }

  /** Skills actually loaded by the sidecar (source of truth for LLM). */
  get loadedSkills(): SkillDefinition[] {
    return this._loadedSkills;
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
        // Capture skills from sidecar ready event — this is what the LLM actually sees
        if (Array.isArray(payload.skills)) {
          this._loadedSkills = (payload.skills as SidecarSkillInfo[]).map((s) => ({
            id: s.id,
            name: s.name,
            description: s.description,
            group: s.group,
            source: s.source,
            editable: s.editable,
          }));
        }
        this.markReady();
      } else if (payload.type === "error" && typeof payload.error === "string") {
        this.errorHandler?.(new Error(payload.error));
      }

      this.dispatch(payload);
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
