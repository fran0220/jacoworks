<script lang="ts">
	import MessageBubble from './MessageBubble.svelte';
	import InputBar from './InputBar.svelte';
	import ToolStatus from './ToolStatus.svelte';
	import { streamFetch, abortStream } from '$lib/api';
	import { parseSSE } from '$lib/sse';
	import { getToken } from '$lib/auth.svelte';
	import { GATEWAY_URL, DEFAULT_SYSTEM_PROMPT, DEFAULT_MODEL, MODEL_OPTIONS } from '$lib/config';
	import {
		updateSession,
		generateTitle,
		type ChatMessage,
		type ChatSession,
		type MessageContent,
		type AttachedFile
	} from '$lib/sessions';
	import {
		getIsStreaming,
		setIsStreaming,
		getAbortController,
		setAbortController
	} from '$lib/stores/app.svelte';
	import { pullChanges } from '$lib/cowork';

	let {
		session,
		onSessionUpdate,
		pendingMessage = null,
		onPendingMessageSent = () => {}
	}: {
		session: ChatSession | null;
		onSessionUpdate: () => void;
		pendingMessage?: string | null;
		onPendingMessageSent?: () => void;
	} = $props();

	let messagesEl: HTMLDivElement | undefined = $state();
	let streamingContent = $state('');
	let currentTool = $state<string | null>(null);
	let statusMessage = $state<string | null>(null);
	let syncStatus = $state<string | null>(null);

	let streaming = $derived(getIsStreaming());
	let messages = $derived(session?.messages.filter((m) => m.role !== 'system') ?? []);
	let activeModel = $derived(session?.model || DEFAULT_MODEL);
	let activeModelLabel = $derived(MODEL_OPTIONS.find(m => m.value === activeModel)?.label ?? activeModel);

	$effect(() => {
		messages;
		streamingContent;
		currentTool;
		statusMessage;
		scrollToBottom();
	});

	$effect(() => {
		if (pendingMessage && session && !getIsStreaming()) {
			const msg = pendingMessage;
			onPendingMessageSent();
			requestAnimationFrame(() => sendMessage(msg));
		}
	});

	function scrollToBottom() {
		requestAnimationFrame(() => {
			if (messagesEl) {
				messagesEl.scrollTop = messagesEl.scrollHeight;
			}
		});
	}

	async function sendMessage(text: string, attachments?: AttachedFile[]) {
		if (!session || getIsStreaming()) return;

		let userMsg: ChatMessage;

		if (attachments?.length) {
			const parts: MessageContent[] = [];
			for (const file of attachments) {
				if (file.type === 'image') {
					parts.push({ type: 'image_url', image_url: { url: file.data } });
				} else {
					parts.push({ type: 'text', text: `[文件: ${file.name}]\n${file.data}` });
				}
			}
			parts.push({ type: 'text', text });
			userMsg = { role: 'user', content: parts };
		} else {
			userMsg = { role: 'user', content: text };
		}

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
		currentTool = null;
		let aborted = false;

		try {
			const token = getToken();
			const extraHeaders: Record<string, string> = {};
			if (session?.type === 'cowork') {
				extraHeaders['X-Cowork-Session'] = session.id;
			}
			const response = await streamFetch(`${GATEWAY_URL}/v1/chat/completions`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${token}`,
					...extraHeaders
				},
				body: JSON.stringify({
					model: activeModel,
					messages: allMessages.map((m) => ({ role: m.role, content: m.content })),
					stream: true,
					session_id: session.id
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

			for await (const event of parseSSE(response.body)) {
				if (aborted) break;
				if (event.type === 'done') break;
				if (event.type === 'tool_start') {
					currentTool = event.toolName ?? null;
					statusMessage = null;
				} else if (event.type === 'status') {
					statusMessage = event.statusMessage ?? null;
				} else if (event.type === 'content') {
					currentTool = null;
					statusMessage = null;
					fullContent += event.content;
					streamingContent = fullContent;
				}
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
			currentTool = null;
			statusMessage = null;
			setAbortController(null);

			if (session?.type === 'cowork' && session.workspacePath && !aborted) {
				syncStatus = '正在同步文件...';
				try {
					const count = await pullChanges(session.id, session.workspacePath);
					if (count > 0) {
						syncStatus = `✅ 已同步 ${count} 个文件`;
						setTimeout(() => syncStatus = null, 3000);
					} else {
						syncStatus = null;
					}
				} catch {
					syncStatus = '⚠️ 文件同步失败';
					setTimeout(() => syncStatus = null, 5000);
				}
			}
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

		{#if streaming && currentTool}
			<ToolStatus toolName={currentTool} />
		{/if}

		{#if streaming && statusMessage}
			<div class="status-hint">
				<span class="spinner-sm"></span>
				{statusMessage}
			</div>
		{/if}
	</div>

	{#if syncStatus}
		<div class="sync-status">{syncStatus}</div>
	{/if}
	<InputBar onSend={sendMessage} onStop={handleStop} isStreaming={streaming} />
</div>

<style>
	.chat-view {
		flex: 1;
		display: flex;
		flex-direction: column;
		height: calc(100vh - var(--titlebar-height));
		min-width: 0;
	}

	.messages {
		flex: 1;
		overflow-y: auto;
		padding: var(--space-8) 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	.empty {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		color: var(--text-muted);
		gap: var(--space-4);
	}

	.empty-icon {
		font-size: var(--space-13);
	}

	.sync-status {
		padding: var(--space-3) var(--space-8);
		font-size: var(--text-xs);
		color: var(--text-secondary);
		text-align: center;
		background: var(--bg-tertiary);
		border-top: 1px solid var(--border);
	}

	.status-hint {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-3);
		padding: var(--space-2) var(--space-8);
		margin: var(--space-1) var(--space-10);
		font-size: var(--text-2xs);
		color: var(--text-muted);
	}

	.spinner-sm {
		width: var(--size-spinner-sm);
		height: var(--size-spinner-sm);
		border: 1.5px solid var(--border);
		border-top-color: var(--accent);
		border-radius: var(--radius-full);
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		to { transform: rotate(360deg); }
	}
</style>
