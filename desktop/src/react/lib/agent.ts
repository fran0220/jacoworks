import type { AgentTransport } from "./agent-transport";

export interface PromptPayload {
  session_id: string;
  user_id?: string;
  model?: string;
  message: string;
  workspace?: string;
  restricted?: boolean;
  streaming_behavior?: "steer" | "followUp";
  thinking_level?: string;
  anonymous?: boolean;
}

export interface AgentRpcEvent {
  type: string;
  session_id?: string;
  error?: string;
  [key: string]: unknown;
}

class AsyncEventQueue<T> {
  private values: T[] = [];
  private resolvers: Array<(value: IteratorResult<T>) => void> = [];
  private closed = false;

  push(value: T) {
    if (this.closed) return;
    const resolver = this.resolvers.shift();
    if (resolver) {
      resolver({ value, done: false });
      return;
    }
    this.values.push(value);
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    while (this.resolvers.length > 0) {
      const resolver = this.resolvers.shift();
      resolver?.({ value: undefined as never, done: true });
    }
  }

  async next(): Promise<IteratorResult<T>> {
    const value = this.values.shift();
    if (value !== undefined) {
      return { value, done: false };
    }
    if (this.closed) {
      return { value: undefined as never, done: true };
    }
    return new Promise<IteratorResult<T>>((resolve) => {
      this.resolvers.push(resolve);
    });
  }
}

export async function startAgentStream(
  transport: AgentTransport,
  payload: PromptPayload,
): Promise<{
  stream: AsyncGenerator<AgentRpcEvent>;
  cancel: () => void;
}> {
  const queue = new AsyncEventQueue<AgentRpcEvent>();

  const unsubscribe = transport.subscribe((packet) => {
    if (typeof packet.session_id === "string" && packet.session_id !== payload.session_id) {
      return;
    }
    queue.push(packet);
    if (packet.type === "agent_end" || packet.type === "error") {
      queue.close();
    }
  });

  try {
    await transport.ensureSession(payload.session_id, {
      userId: payload.user_id,
      model: payload.model,
      workspace: payload.workspace,
      restricted: payload.restricted,
      streamingBehavior: payload.streaming_behavior,
      thinkingLevel: payload.thinking_level,
      anonymous: payload.anonymous,
    });
    await transport.sendMessage(payload.session_id, payload.message);
  } catch (err) {
    unsubscribe();
    throw err;
  }

  const cancel = () => {
    queue.close();
    unsubscribe();
  };

  const stream = (async function* () {
    try {
      while (true) {
        const next = await queue.next();
        if (next.done) break;
        yield next.value;
      }
    } finally {
      unsubscribe();
    }
  })();

  return { stream, cancel };
}

export function abortAgentSession(transport: AgentTransport, sessionId: string): void {
  void transport.abortSession(sessionId).catch(() => {});
}
