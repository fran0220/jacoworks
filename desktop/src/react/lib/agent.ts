import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

interface NativePromptPayload {
  session_id: string;
  user_id?: string;
  model?: string;
  message: string;
  workspace?: string;
  restricted?: boolean;
  streaming_behavior?: "steer" | "followUp";
}

export interface AgentRpcEvent {
  id?: string | number;
  type: string;
  session_id?: string;
  command?: string;
  success?: boolean;
  error?: string;
  event?: {
    type: string;
    [key: string]: unknown;
  };
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

let commandCounter = 0;

function nextCommandId(prefix: string): string {
  commandCounter += 1;
  return `${prefix}-${Date.now()}-${commandCounter}`;
}

async function sendRpcCommand(command: Record<string, unknown>) {
  if (!isTauri()) {
    throw new Error("RPC transport is only available in Tauri runtime");
  }
  await invoke("agent_rpc_send", { command });
}

export async function startNativeStream(payload: NativePromptPayload): Promise<{
  requestId: string;
  stream: AsyncGenerator<AgentRpcEvent>;
}> {
  if (!isTauri()) {
    throw new Error("RPC transport is only available in Tauri runtime");
  }

  const requestId = nextCommandId("prompt");
  const queue = new AsyncEventQueue<AgentRpcEvent>();

  const unlisten = await listen<AgentRpcEvent>("agent-rpc-event", (event) => {
    const packet = event.payload;
    if (String(packet.id ?? "") !== requestId) return;
    queue.push(packet);
    if (packet.type === "done" || packet.type === "error") {
      queue.close();
    }
  });

  try {
    await sendRpcCommand({ id: requestId, type: "prompt", ...payload });
  } catch (err) {
    unlisten();
    throw err;
  }

  const stream = (async function* () {
    try {
      while (true) {
        const next = await queue.next();
        if (next.done) break;
        yield next.value;
      }
    } finally {
      unlisten();
    }
  })();

  return { requestId, stream };
}

export async function abortNativeSession(sessionId: string) {
  const id = nextCommandId("abort");
  await sendRpcCommand({ id, type: "abort", session_id: sessionId });
}
