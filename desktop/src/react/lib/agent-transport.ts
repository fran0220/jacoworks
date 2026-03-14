import type { AgentRpcEvent } from "./agent";

export interface AgentTransport {
  readonly isReady: boolean;
  connect(): Promise<void>;
  close(): void;
  send(command: Record<string, unknown>): void;
  /** @deprecated Use subscribe() instead */
  onMessage(handler: ((packet: AgentRpcEvent) => void) | null): void;
  /** Subscribe to incoming packets. Returns unsubscribe function. */
  subscribe(handler: (packet: AgentRpcEvent) => void): () => void;
  onReady(handler: (() => void) | null): void;
  onError(handler: ((error: Error) => void) | null): void;
}
