export interface SSEEvent {
	type: 'content' | 'tool_start' | 'status' | 'done';
	content?: string;
	toolName?: string;
	statusMessage?: string;
}

function parseComment(text: string): SSEEvent | null {
	const t = text.trim();
	const toolMatch = t.match(/^tool\s+(\S+)\s+started$/);
	if (toolMatch) return { type: 'tool_start', toolName: toolMatch[1] };
	if (t.startsWith('compaction ') || t.startsWith('retry ')) {
		return { type: 'status', statusMessage: t };
	}
	return null;
}

function* parseLines(lines: string[]): Generator<SSEEvent> {
	for (const line of lines) {
		// SSE comment: vm-agent sends tool/compaction/retry status as comments
		if (line.startsWith(': ')) {
			const evt = parseComment(line.slice(2));
			if (evt) yield evt;
			continue;
		}

		if (!line.startsWith('data:')) continue;
		const data = line.slice(5).trimStart();

		if (data === '[DONE]') {
			yield { type: 'done' };
			return;
		}

		try {
			const json = JSON.parse(data);
			const delta = json.choices?.[0]?.delta;
			if (delta?.content) {
				yield { type: 'content', content: delta.content };
			}
		} catch {
			// skip malformed JSON
		}
	}
}

export async function* parseSSE(
	stream: ReadableStream<Uint8Array>
): AsyncGenerator<SSEEvent> {
	const reader = stream.getReader();
	const decoder = new TextDecoder('utf-8', { fatal: false });
	let buffer = '';

	try {
		while (true) {
			const { value, done } = await reader.read();
			if (done) break;

			buffer += decoder.decode(value, { stream: true });
			buffer = buffer.replace(/\r/g, '');

			const parts = buffer.split('\n\n');
			buffer = parts.pop() ?? '';

			for (const part of parts) {
				for (const evt of parseLines(part.split('\n'))) {
					yield evt;
					if (evt.type === 'done') return;
				}
			}
		}

		if (buffer.trim()) {
			for (const evt of parseLines(buffer.split('\n'))) {
				yield evt;
				if (evt.type === 'done') return;
			}
		}
	} finally {
		reader.releaseLock();
	}
}
