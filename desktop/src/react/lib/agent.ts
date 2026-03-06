import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { CloudAgentWS } from "./cloud-agent-ws";

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

type NativePromptPayload = PromptPayload;
export type CloudPromptPayload = PromptPayload;

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
  cancel: () => void;
}> {
  if (!isTauri()) {
    throw new Error("RPC transport is only available in Tauri runtime");
  }

  const requestId = nextCommandId("prompt");
  const queue = new AsyncEventQueue<AgentRpcEvent>();

  const unlisten = await listen<AgentRpcEvent>("agent-rpc-event", (event) => {
    const packet = event.payload;
    // Broadcast fatal errors (no id) like "Agent 进程已退出" must reach every active stream
    if (!packet.id && packet.type === "error") {
      queue.push(packet);
      queue.close();
      return;
    }
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

  const cancel = () => {
    queue.close();
    unlisten();
  };

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

  return { requestId, stream, cancel };
}

export async function abortNativeSession(sessionId: string) {
  const id = nextCommandId("abort");
  await sendRpcCommand({ id, type: "abort", session_id: sessionId });
}

export async function requestTitleGeneration(
  userMessage: string,
  assistantMessage: string,
): Promise<string | null> {
  if (!isTauri()) return null;

  const id = nextCommandId("title");
  let cleanup: (() => void) | null = null;

  return new Promise<string | null>(async (resolve) => {
    let resolved = false;
    const done = (value: string | null) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      cleanup?.();
      resolve(value);
    };

    const timeout = setTimeout(() => done(null), 15_000);

    const unsub = await listen<AgentRpcEvent>("agent-rpc-event", (event) => {
      const packet = event.payload;
      if (String(packet.id ?? "") !== id) return;
      if (packet.type === "response") {
        if (packet.success && (packet.data as { title?: string })?.title) {
          done((packet.data as { title: string }).title);
        } else {
          done(null);
        }
      }
    });
    cleanup = unsub;

    try {
      await sendRpcCommand({
        id,
        type: "generate_title",
        user_message: userMessage,
        assistant_message: assistantMessage,
      });
    } catch {
      done(null);
    }
  });
}

export async function startCloudStream(
  ws: CloudAgentWS,
  payload: CloudPromptPayload,
  onMessage: (handler: ((packet: AgentRpcEvent) => void) | null) => void,
): Promise<{
  requestId: string;
  stream: AsyncGenerator<AgentRpcEvent>;
  cancel: () => void;
}> {
  const requestId = nextCommandId("prompt");
  const queue = new AsyncEventQueue<AgentRpcEvent>();

  onMessage((packet) => {
    if (!packet.id && packet.type === "error") {
      queue.push(packet);
      queue.close();
      return;
    }
    if (String(packet.id ?? "") !== requestId) return;
    queue.push(packet);
    if (packet.type === "done" || packet.type === "error") {
      queue.close();
    }
  });

  try {
    ws.send({ id: requestId, type: "prompt", ...payload });
  } catch (err) {
    onMessage(null);
    throw err;
  }

  const cancel = () => {
    queue.close();
    onMessage(null);
  };

  const stream = (async function* () {
    try {
      while (true) {
        const next = await queue.next();
        if (next.done) break;
        yield next.value;
      }
    } finally {
      onMessage(null);
    }
  })();

  return { requestId, stream, cancel };
}

export function abortCloudSession(ws: CloudAgentWS, sessionId: string): void {
  const id = nextCommandId("abort");
  ws.send({ id, type: "abort", session_id: sessionId });
}

export async function requestCloudTitleGeneration(
  ws: CloudAgentWS,
  userMessage: string,
  assistantMessage: string,
  onMessage: (handler: ((packet: AgentRpcEvent) => void) | null) => void,
): Promise<string | null> {
  const id = nextCommandId("title");
  return new Promise<string | null>((resolve) => {
    let resolved = false;
    const done = (value: string | null) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      onMessage(null);
      resolve(value);
    };

    const timeout = setTimeout(() => done(null), 15_000);

    onMessage((packet) => {
      if (String(packet.id ?? "") !== id) return;
      if (packet.type === "response") {
        if (packet.success && (packet.data as { title?: string })?.title) {
          done((packet.data as { title: string }).title);
        } else {
          done(null);
        }
      }
    });

    try {
      ws.send({ id, type: "generate_title", user_message: userMessage, assistant_message: assistantMessage });
    } catch {
      done(null);
    }
  });
}
