export interface PromptQueue {
  enqueue(prompt: string): Promise<string>;
  isProcessing(): boolean;
}

export interface PromptQueueOptions {
  timeoutMs?: number; // default 300_000 (5min)
}

interface QueueItem {
  prompt: string;
  resolve: (result: string) => void;
  reject: (error: Error) => void;
}

export function createPromptQueue(
  executeFn: (prompt: string) => Promise<string>,
  options?: PromptQueueOptions,
): PromptQueue {
  const timeoutMs = options?.timeoutMs ?? 300_000;
  const queue: QueueItem[] = [];
  let processing = false;

  async function processNext() {
    if (processing || queue.length === 0) return;
    processing = true;

    const item = queue.shift()!;
    try {
      const result = await Promise.race([
        executeFn(item.prompt),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Prompt timeout after ${timeoutMs}ms`)), timeoutMs),
        ),
      ]);
      item.resolve(result);
    } catch (err) {
      item.reject(err instanceof Error ? err : new Error(String(err)));
    } finally {
      processing = false;
      processNext();
    }
  }

  return {
    enqueue(prompt: string): Promise<string> {
      return new Promise<string>((resolve, reject) => {
        queue.push({ prompt, resolve, reject });
        processNext();
      });
    },
    isProcessing() {
      return processing;
    },
  };
}
