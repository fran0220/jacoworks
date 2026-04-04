import type { AgentRpcEvent } from "./agent";

export interface AgentSessionOptions {
  userId?: string;
  model?: string;
  workspace?: string;
  restricted?: boolean;
  streamingBehavior?: "steer" | "followUp";
  thinkingLevel?: string;
  anonymous?: boolean;
}

export interface AgentTransport {
  readonly isReady: boolean;
  connect(): Promise<void>;
  close(): void;
  ensureSession(sessionId: string, options?: AgentSessionOptions): Promise<void>;
  sendMessage(sessionId: string, message: string): Promise<void>;
  abortSession(sessionId: string): Promise<void>;
  /** @deprecated Use subscribe() instead */
  onMessage(handler: ((packet: AgentRpcEvent) => void) | null): void;
  /** Subscribe to incoming packets. Returns unsubscribe function. */
  subscribe(handler: (packet: AgentRpcEvent) => void): () => void;
  onReady(handler: (() => void) | null): void;
  onError(handler: ((error: Error) => void) | null): void;
}
