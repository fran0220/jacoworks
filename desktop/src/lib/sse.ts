export async function* parseSSE(
	stream: ReadableStream<Uint8Array>
): AsyncGenerator<{ content: string; done: boolean }> {
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
				const lines = part.split('\n');
				for (const line of lines) {
					if (!line.startsWith('data:')) continue;
					const data = line.slice(5).trimStart();

					if (data === '[DONE]') {
						yield { content: '', done: true };
						return;
					}

					try {
						const json = JSON.parse(data);
						const delta = json.choices?.[0]?.delta?.content;
						if (delta) {
							yield { content: delta, done: false };
						}
					} catch {
						// skip malformed JSON
					}
				}
			}
		}

		// flush remaining buffer
		if (buffer.trim()) {
			const lines = buffer.split('\n');
			for (const line of lines) {
				if (!line.startsWith('data:')) continue;
				const data = line.slice(5).trimStart();
				if (data === '[DONE]') {
					yield { content: '', done: true };
					return;
				}
				try {
					const json = JSON.parse(data);
					const delta = json.choices?.[0]?.delta?.content;
					if (delta) {
						yield { content: delta, done: false };
					}
				} catch {
					// skip
				}
			}
		}
	} finally {
		reader.releaseLock();
	}
}
