<script lang="ts">
	import Markdown from './Markdown.svelte';
	import type { ChatMessage, MessageContent } from '$lib/sessions';

	let { message, streaming = false }: { message: ChatMessage; streaming?: boolean } = $props();

	let isUser = $derived(message.role === 'user');
	let isMultipart = $derived(Array.isArray(message.content));

	let textContent = $derived(
		typeof message.content === 'string'
			? message.content
			: (message.content as MessageContent[])
					.filter((p) => p.type === 'text')
					.map((p) => p.text)
					.join('\n')
	);

	let imageUrls = $derived(
		Array.isArray(message.content)
			? (message.content as MessageContent[])
					.filter((p) => p.type === 'image_url' && p.image_url?.url)
					.map((p) => p.image_url!.url)
			: []
	);
</script>

<div class="bubble-row" class:user={isUser}>
	<div class="bubble" class:user-bubble={isUser} class:assistant-bubble={!isUser}>
		{#if isUser}
			{#if imageUrls.length > 0}
				<div class="attached-images">
					{#each imageUrls as url}
						<img src={url} alt="附件图片" class="attached-img" loading="lazy" />
					{/each}
				</div>
			{/if}
			<p class="user-text">{textContent}</p>
		{:else}
			<Markdown content={typeof message.content === 'string' ? message.content : textContent} />
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

	.attached-images {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin-bottom: 8px;
	}

	.attached-img {
		max-width: 200px;
		max-height: 200px;
		border-radius: var(--radius);
		object-fit: cover;
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
