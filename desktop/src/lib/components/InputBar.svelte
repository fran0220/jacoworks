<script lang="ts">
	let {
		onSend,
		onStop,
		isStreaming
	}: {
		onSend: (text: string) => void;
		onStop: () => void;
		isStreaming: boolean;
	} = $props();

	let text = $state('');
	let textareaEl: HTMLTextAreaElement | undefined = $state();

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			send();
		}
	}

	function send() {
		const trimmed = text.trim();
		if (!trimmed || isStreaming) return;
		onSend(trimmed);
		text = '';
		if (textareaEl) textareaEl.style.height = 'auto';
	}

	function autoResize() {
		if (!textareaEl) return;
		textareaEl.style.height = 'auto';
		textareaEl.style.height = Math.min(textareaEl.scrollHeight, 200) + 'px';
	}
</script>

<div class="input-bar">
	<textarea
		bind:this={textareaEl}
		bind:value={text}
		oninput={autoResize}
		onkeydown={handleKeydown}
		placeholder="输入消息…"
		rows={1}
		disabled={isStreaming}
	></textarea>
	<div class="actions">
		{#if isStreaming}
			<button class="btn-stop" onclick={onStop} title="停止生成">
				<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
					<rect x="6" y="6" width="12" height="12" rx="2" />
				</svg>
			</button>
		{:else}
			<button
				class="btn-send"
				onclick={send}
				disabled={!text.trim()}
				title="发送"
			>
				<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<path d="M22 2L11 13" />
					<path d="M22 2L15 22L11 13L2 9L22 2Z" />
				</svg>
			</button>
		{/if}
	</div>
</div>

<style>
	.input-bar {
		display: flex;
		align-items: flex-end;
		gap: 8px;
		padding: 12px 24px 16px;
		border-top: 1px solid var(--border);
		background: var(--bg-primary);
	}

	textarea {
		flex: 1;
		resize: none;
		padding: 10px 14px;
		background: var(--bg-input);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		color: var(--text-primary);
		line-height: 1.5;
		max-height: 200px;
		transition: border-color 0.2s;
	}

	textarea:focus {
		border-color: var(--accent);
	}

	textarea:disabled {
		opacity: 0.6;
	}

	textarea::placeholder {
		color: var(--text-muted);
	}

	.actions {
		display: flex;
		gap: 4px;
		padding-bottom: 2px;
	}

	.btn-send,
	.btn-stop {
		width: 38px;
		height: 38px;
		border-radius: var(--radius);
		display: flex;
		align-items: center;
		justify-content: center;
		transition: background 0.2s;
	}

	.btn-send {
		background: var(--accent);
		color: #fff;
	}

	.btn-send:hover:not(:disabled) {
		background: var(--accent-hover);
	}

	.btn-send:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.btn-stop {
		background: var(--danger);
		color: #fff;
	}

	.btn-stop:hover {
		background: var(--danger-hover);
	}
</style>
