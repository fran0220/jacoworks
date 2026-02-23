<script lang="ts">
	import MessageBubble from './MessageBubble.svelte';
	import InputBar from './InputBar.svelte';
	import { streamFetch, abortStream } from '$lib/api';
	import { parseSSE } from '$lib/sse';
	import { getToken } from '$lib/auth.svelte';
	import { GATEWAY_URL, DEFAULT_SYSTEM_PROMPT } from '$lib/config';
	import {
		updateSession,
		generateTitle,
		type ChatMessage,
		type ChatSession
	} from '$lib/sessions';
	import {
		getIsStreaming,
		setIsStreaming,
		getAbortController,
		setAbortController
	} from '$lib/stores/app.svelte';

	let {
		session,
		onSessionUpdate
	}: {
		session: ChatSession | null;
		onSessionUpdate: () => void;
	} = $props();

	let messagesEl: HTMLDivElement | undefined = $state();
	let streamingContent = $state('');

	let streaming = $derived(getIsStreaming());
	let messages = $derived(session?.messages.filter((m) => m.role !== 'system') ?? []);

	$effect(() => {
		messages;
		streamingContent;
		scrollToBottom();
	});

	function scrollToBottom() {
		requestAnimationFrame(() => {
			if (messagesEl) {
				messagesEl.scrollTop = messagesEl.scrollHeight;
			}
		});
	}

	async function sendMessage(text: string) {
		if (!session || getIsStreaming()) return;

		const userMsg: ChatMessage = { role: 'user', content: text };

		const allMessages: ChatMessage[] = [
			{ role: 'system', content: DEFAULT_SYSTEM_PROMPT },
			...session.messages.filter((m) => m.role !== 'system'),
			userMsg
		];

		session.messages = [...session.messages, userMsg];
		await updateSession(session.id, { messages: session.messages });
		onSessionUpdate();

		setIsStreaming(true);
		streamingContent = '';
		let aborted = false;

		try {
			const token = getToken();
			const response = await streamFetch(`${GATEWAY_URL}/v1/chat/completions`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${token}`
				},
				body: JSON.stringify({
					model: 'proxy-claude/claude-sonnet-4-6',
					messages: allMessages.map((m) => ({ role: m.role, content: m.content })),
					stream: true
				})
			});

			if (response.status !== 200) {
				throw new Error(`请求失败 (${response.status})`);
			}

			setAbortController(async () => {
				aborted = true;
				abortStream(response.requestId);
			});

			let fullContent = '';

			for await (const chunk of parseSSE(response.body)) {
				if (aborted) break;
				if (chunk.done) break;
				fullContent += chunk.content;
				streamingContent = fullContent;
			}

			const assistantMsg: ChatMessage = { role: 'assistant', content: fullContent };
			session.messages = [...session.messages, assistantMsg];

			const nonSystemMsgs = session.messages.filter((m) => m.role !== 'system');
			const assistantMsgs = nonSystemMsgs.filter((m) => m.role === 'assistant');
			if (assistantMsgs.length === 1 && session.title === '新对话') {
				session.title = generateTitle(fullContent);
			}

			await updateSession(session.id, {
				messages: session.messages,
				title: session.title
			});
			onSessionUpdate();
		} catch (err: any) {
			if (!aborted) {
				const errorMsg: ChatMessage = {
					role: 'assistant',
					content: `⚠️ ${err.message || '请求失败'}`
				};
				session.messages = [...session.messages, errorMsg];
				await updateSession(session.id, { messages: session.messages });
				onSessionUpdate();
			}
		} finally {
			setIsStreaming(false);
			streamingContent = '';
			setAbortController(null);
		}
	}

	function handleStop() {
		const abort = getAbortController();
		if (abort) abort();
	}
</script>

<div class="chat-view">
	<div class="messages" bind:this={messagesEl}>
		{#if messages.length === 0 && !streaming}
			<div class="empty">
				<p class="empty-icon">💬</p>
				<p>开始新的对话</p>
			</div>
		{/if}

		{#each messages as msg, i (i)}
			<MessageBubble message={msg} />
		{/each}

		{#if streaming && streamingContent}
			<MessageBubble
				message={{ role: 'assistant', content: streamingContent }}
				streaming={true}
			/>
		{/if}
	</div>

	<InputBar onSend={sendMessage} onStop={handleStop} isStreaming={streaming} />
</div>

<style>
	.chat-view {
		flex: 1;
		display: flex;
		flex-direction: column;
		height: calc(100vh - var(--topbar-height));
		min-width: 0;
	}

	.messages {
		flex: 1;
		overflow-y: auto;
		padding: 16px 0;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.empty {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		color: var(--text-muted);
		gap: 8px;
	}

	.empty-icon {
		font-size: 48px;
	}
</style>
