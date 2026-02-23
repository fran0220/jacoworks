interface StreamResponse {
	requestId: number;
	status: number;
	headers: Record<string, string>;
	body: ReadableStream<Uint8Array>;
}

interface ChunkPayload {
	request_id: number;
	chunk: number[];
}

interface EndPayload {
	request_id: number;
	error?: string;
}

function isTauri(): boolean {
	return typeof window !== 'undefined' && '__TAURI__' in window;
}

let requestCounter = 0;

async function tauriFetch(
	url: string,
	options: { method?: string; headers?: Record<string, string>; body?: string }
): Promise<StreamResponse> {
	const { invoke } = await import('@tauri-apps/api/core');
	const { listen } = await import('@tauri-apps/api/event');

	const requestId = ++requestCounter;
	const method = options.method ?? 'GET';
	const headers = options.headers ?? {};
	const body = options.body ?? null;

	let streamController: ReadableStreamDefaultController<Uint8Array>;

	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			streamController = controller;
		}
	});

	const unlistenChunk = await listen<ChunkPayload>('stream-response', (event) => {
		if (event.payload.request_id !== requestId) return;
		streamController.enqueue(new Uint8Array(event.payload.chunk));
	});

	const unlistenEnd = await listen<EndPayload>('stream-end', (event) => {
		if (event.payload.request_id !== requestId) return;
		if (event.payload.error && event.payload.error !== 'aborted') {
			streamController.error(new Error(event.payload.error));
		} else {
			streamController.close();
		}
		unlistenChunk();
		unlistenEnd();
	});

	let result: { request_id: number; status: number; headers: Record<string, string> };
	try {
		result = await invoke('stream_fetch', {
			requestId,
			url,
			method,
			headers,
			body: body || undefined
		});
	} catch (err) {
		unlistenChunk();
		unlistenEnd();
		streamController!.error(err instanceof Error ? err : new Error(String(err)));
		throw err;
	}

	return {
		requestId,
		status: result.status,
		headers: result.headers,
		body: stream
	};
}

async function browserFetch(
	url: string,
	options: { method?: string; headers?: Record<string, string>; body?: string }
): Promise<StreamResponse> {
	const resp = await fetch(url, {
		method: options.method ?? 'GET',
		headers: options.headers ?? {},
		body: options.body
	});

	const respHeaders: Record<string, string> = {};
	resp.headers.forEach((v, k) => {
		respHeaders[k] = v;
	});

	return {
		requestId: 0,
		status: resp.status,
		headers: respHeaders,
		body: resp.body!
	};
}

export async function streamFetch(
	url: string,
	options: { method?: string; headers?: Record<string, string>; body?: string } = {}
): Promise<StreamResponse> {
	if (isTauri()) {
		return tauriFetch(url, options);
	}
	return browserFetch(url, options);
}

export async function abortStream(requestId: number): Promise<void> {
	if (!isTauri()) return;
	const { invoke } = await import('@tauri-apps/api/core');
	try {
		await invoke('stream_abort', { requestId });
	} catch {
		// already completed
	}
}
