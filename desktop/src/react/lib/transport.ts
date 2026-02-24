import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

interface ChunkPayload {
  request_id: number;
  chunk: number[];
}

interface EndPayload {
  request_id: number;
  error?: string;
}

export interface StreamResponse {
  requestId: number;
  status: number;
  headers: Record<string, string>;
  body: ReadableStream<Uint8Array>;
}

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI__" in window;
}

let requestCounter = 0;

export async function streamFetch(
  url: string,
  options: { method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<StreamResponse> {
  if (!isTauri()) {
    const response = await fetch(url, {
      method: options.method ?? "GET",
      headers: options.headers,
      body: options.body,
    });
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });
    return {
      requestId: 0,
      status: response.status,
      headers,
      body: response.body!,
    };
  }

  const requestId = ++requestCounter;
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(ctrl) {
      controller = ctrl;
    },
  });

  const unlistenChunk = await listen<ChunkPayload>("stream-response", (event) => {
    if (event.payload.request_id !== requestId || !controller) return;
    controller.enqueue(new Uint8Array(event.payload.chunk));
  });

  const unlistenEnd = await listen<EndPayload>("stream-end", (event) => {
    if (event.payload.request_id !== requestId || !controller) return;
    if (event.payload.error && event.payload.error !== "aborted") {
      controller.error(new Error(event.payload.error));
    } else {
      controller.close();
    }
    unlistenChunk();
    unlistenEnd();
  });

  const result = await invoke<{ request_id: number; status: number; headers: Record<string, string> }>(
    "stream_fetch",
    {
      requestId,
      url,
      method: options.method ?? "GET",
      headers: options.headers ?? {},
      body: options.body,
    },
  );

  return {
    requestId,
    status: result.status,
    headers: result.headers,
    body: stream,
  };
}

export async function abortStream(requestId: number) {
  if (!isTauri()) return;
  try {
    await invoke("stream_abort", { requestId });
  } catch {
    // Stream may already be closed.
  }
}

export async function httpFetch(
  url: string,
  options: { method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<{ status: number; headers: Record<string, string>; body: string }> {
  if (!isTauri()) {
    const response = await fetch(url, {
      method: options.method ?? "GET",
      headers: options.headers,
      body: options.body,
    });
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });
    return { status: response.status, headers, body: await response.text() };
  }

  return invoke("http_fetch", {
    url,
    method: options.method ?? "GET",
    headers: options.headers ?? {},
    body: options.body,
  });
}
