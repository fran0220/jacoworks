import { spawn } from "bun";

const DEFAULT_TIMEOUT_MS = 50_000;

export interface RpcMessage {
  id?: string | number;
  type: string;
  [key: string]: unknown;
}

export class RpcClient {
  private proc: ReturnType<typeof spawn>;
  private buffer = "";
  private pending: Array<(msg: RpcMessage) => void> = [];
  private messages: RpcMessage[] = [];
  private reader: ReadableStreamDefaultReader<Uint8Array>;
  private stdin: { write(data: string | Uint8Array): number };
  private stderrChunks: string[] = [];

  constructor(proc: ReturnType<typeof spawn>) {
    this.proc = proc;
    this.stdin = proc.stdin as unknown as { write(data: string | Uint8Array): number };
    const stdout = proc.stdout as ReadableStream<Uint8Array>;
    this.reader = stdout.getReader();
    this.startReading();
    this.startStderrReading();
  }

  private async startReading() {
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { done, value } = await this.reader.read();
        if (done) break;
        this.buffer += decoder.decode(value, { stream: true });
        this.processBuffer();
      }
    } catch {
      // process closed
    }
  }

  private async startStderrReading() {
    const stderr = this.proc.stderr as ReadableStream<Uint8Array>;
    const reader = stderr.getReader();
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        this.stderrChunks.push(decoder.decode(value, { stream: true }));
      }
    } catch {
      // process closed
    }
  }

  private processBuffer() {
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() || "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const msg = JSON.parse(trimmed) as RpcMessage;
        this.messages.push(msg);
        const pending = this.pending.slice();
        this.pending = [];
        for (const resolve of pending) resolve(msg);
      } catch {
        // non-json line
      }
    }
  }

  send(cmd: Record<string, unknown>) {
    this.stdin.write(JSON.stringify(cmd) + "\n");
  }

  async waitFor(predicate: (msg: RpcMessage) => boolean, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<RpcMessage> {
    const existing = this.messages.find(predicate);
    if (existing) return existing;

    return new Promise<RpcMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(
          `waitFor timeout (${timeoutMs}ms).\n` +
          `Last msgs: ${JSON.stringify(this.messages.slice(-3))}\n` +
          `Stderr: ${this.stderrChunks.join("").slice(-300)}`,
        ));
      }, timeoutMs);

      const check = (msg: RpcMessage) => {
        if (predicate(msg)) {
          clearTimeout(timer);
          resolve(msg);
        } else {
          this.pending.push(check);
        }
      };

      this.pending.push(check);
    });
  }

  async waitReady(timeoutMs = 20_000): Promise<RpcMessage> {
    return this.waitFor((m) => m.type === "ready", timeoutMs);
  }

  async request(cmd: Record<string, unknown>): Promise<RpcMessage> {
    const id = `t-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    this.send({ ...cmd, id });
    return this.waitFor((m) => m.id === id && m.type === "response");
  }

  async collectSessionEvents(cmd: Record<string, unknown>, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<{
    response: RpcMessage;
    sessionEvents: RpcMessage[];
    done: RpcMessage;
    errors: RpcMessage[];
  }> {
    const id = `t-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    this.send({ ...cmd, id });

    let response: RpcMessage | null = null;
    const sessionEvents: RpcMessage[] = [];
    const errors: RpcMessage[] = [];

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(
          `collectSessionEvents timeout (${timeoutMs}ms). response=${!!response}, events=${sessionEvents.length}\n` +
          `Stderr: ${this.stderrChunks.join("").slice(-300)}`,
        ));
      }, timeoutMs);

      const check = (msg: RpcMessage) => {
        if (msg.id !== id) {
          this.pending.push(check);
          return;
        }

        if (msg.type === "response") response = msg;
        else if (msg.type === "session_event") sessionEvents.push(msg);
        else if (msg.type === "error") errors.push(msg);
        else if (msg.type === "done") {
          clearTimeout(timer);
          resolve({ response: response!, sessionEvents, done: msg, errors });
          return;
        }

        this.pending.push(check);
      };

      this.pending.push(check);
    });
  }

  get stderr(): string {
    return this.stderrChunks.join("");
  }

  get allMessages(): RpcMessage[] {
    return this.messages;
  }

  kill() {
    try {
      this.proc.kill();
    } catch {
      // already closed
    }
  }
}
