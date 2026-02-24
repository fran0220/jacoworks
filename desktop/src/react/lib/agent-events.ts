export interface NativeStreamEvent {
  type: string;
  session_id?: string;
  event?: {
    type: string;
    [key: string]: unknown;
  };
}

function* parseLines(lines: string[]): Generator<NativeStreamEvent> {
  for (const line of lines) {
    if (!line.startsWith("data:")) continue;
    const value = line.slice(5).trimStart();
    if (!value) continue;
    try {
      yield JSON.parse(value) as NativeStreamEvent;
    } catch {
      // Ignore malformed packets.
    }
  }
}

export async function* parseNativeSSE(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<NativeStreamEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: false });
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r/g, "");
      const chunks = buffer.split("\n\n");
      buffer = chunks.pop() ?? "";

      for (const chunk of chunks) {
        for (const packet of parseLines(chunk.split("\n"))) {
          yield packet;
        }
      }
    }

    if (buffer.trim()) {
      for (const packet of parseLines(buffer.split("\n"))) {
        yield packet;
      }
    }
  } finally {
    reader.releaseLock();
  }
}
