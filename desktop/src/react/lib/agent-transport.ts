import type { AgentRpcEvent } from "./agent";

export interface AgentTransport {
  readonly isReady: boolean;
  connect(): Promise<void>;
  close(): void;
  send(command: Record<string, unknown>): void;
  onMessage(handler: ((packet: AgentRpcEvent) => void) | null): void;
  onReady(handler: (() => void) | null): void;
  onError(handler: ((error: Error) => void) | null): void;
}
