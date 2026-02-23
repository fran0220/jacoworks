export interface PromptQueue {
  enqueue(prompt: string): Promise<string>;
  isProcessing(): boolean;
}

interface QueueItem {
  prompt: string;
  resolve: (result: string) => void;
  reject: (error: Error) => void;
}

export function createPromptQueue(
  executeFn: (prompt: string) => Promise<string>,
): PromptQueue {
  const queue: QueueItem[] = [];
  let processing = false;

  async function processNext() {
    if (processing || queue.length === 0) return;
    processing = true;

    const item = queue.shift()!;
    try {
      const result = await executeFn(item.prompt);
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
