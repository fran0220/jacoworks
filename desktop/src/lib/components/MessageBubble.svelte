<script lang="ts">
	import Markdown from './Markdown.svelte';
	import type { ChatMessage } from '$lib/sessions';

	let { message, streaming = false }: { message: ChatMessage; streaming?: boolean } = $props();

	let isUser = $derived(message.role === 'user');
</script>

<div class="bubble-row" class:user={isUser}>
	<div class="bubble" class:user-bubble={isUser} class:assistant-bubble={!isUser}>
		{#if isUser}
			<p class="user-text">{message.content}</p>
		{:else}
			<Markdown content={message.content} />
			{#if streaming}
				<span class="cursor">▋</span>
			{/if}
		{/if}
	</div>
</div>

<style>
	.bubble-row {
		display: flex;
		padding: 4px 24px;
	}

	.bubble-row.user {
		justify-content: flex-end;
	}

	.bubble {
		max-width: 75%;
		padding: 10px 16px;
		border-radius: var(--radius-lg);
	}

	.user-bubble {
		background: var(--bg-user-bubble);
		border-bottom-right-radius: 4px;
	}

	.assistant-bubble {
		background: var(--bg-assistant-bubble);
		border-bottom-left-radius: 4px;
	}

	.user-text {
		white-space: pre-wrap;
		word-break: break-word;
	}

	.cursor {
		display: inline-block;
		animation: blink 1s step-end infinite;
		color: var(--accent);
	}

	@keyframes blink {
		50% {
			opacity: 0;
		}
	}
</style>
