<script lang="ts">
	import type { AttachedFile } from '$lib/sessions';

	let {
		onSend,
		onStop,
		isStreaming
	}: {
		onSend: (text: string, attachments?: AttachedFile[]) => void;
		onStop: () => void;
		isStreaming: boolean;
	} = $props();

	let text = $state('');
	let textareaEl: HTMLTextAreaElement | undefined = $state();
	let fileInputEl: HTMLInputElement | undefined = $state();
	let attachments = $state<AttachedFile[]>([]);

	const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

	const imageExts = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg']);

	function isImageFile(file: File): boolean {
		if (file.type.startsWith('image/')) return true;
		const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
		return imageExts.has(ext);
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			send();
		}
	}

	function send() {
		const trimmed = text.trim();
		if ((!trimmed && attachments.length === 0) || isStreaming) return;
		onSend(trimmed || '(附件)', attachments.length > 0 ? [...attachments] : undefined);
		text = '';
		attachments = [];
		if (textareaEl) textareaEl.style.height = 'auto';
	}

	function autoResize() {
		if (!textareaEl) return;
		textareaEl.style.height = 'auto';
		textareaEl.style.height = Math.min(textareaEl.scrollHeight, 200) + 'px';
	}

	function triggerFileInput() {
		fileInputEl?.click();
	}

	async function handleFileChange(e: Event) {
		const input = e.target as HTMLInputElement;
		const files = input.files;
		if (!files) return;

		for (const file of Array.from(files)) {
			if (file.size > MAX_FILE_SIZE) {
				alert(`文件 "${file.name}" 超过 10MB 限制`);
				continue;
			}

			if (isImageFile(file)) {
				const data = await readAsDataURL(file);
				attachments = [...attachments, { name: file.name, type: 'image', data, size: file.size }];
			} else {
				const data = await readAsText(file);
				attachments = [...attachments, { name: file.name, type: 'text', data, size: file.size }];
			}
		}

		input.value = '';
	}

	function readAsDataURL(file: File): Promise<string> {
		return new Promise((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = () => resolve(reader.result as string);
			reader.onerror = () => reject(reader.error);
			reader.readAsDataURL(file);
		});
	}

	function readAsText(file: File): Promise<string> {
		return new Promise((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = () => resolve(reader.result as string);
			reader.onerror = () => reject(reader.error);
			reader.readAsText(file);
		});
	}

	function removeAttachment(index: number) {
		attachments = attachments.filter((_, i) => i !== index);
	}

	function formatSize(bytes: number): string {
		if (bytes < 1024) return bytes + ' B';
		if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
		return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
	}
</script>

<div class="input-bar">
	{#if attachments.length > 0}
		<div class="attachments-preview">
			{#each attachments as file, i (i)}
				<div class="attachment-chip">
					<span class="attachment-icon">{file.type === 'image' ? '🖼️' : '📄'}</span>
					<span class="attachment-name" title={file.name}>{file.name}</span>
					<span class="attachment-size">{formatSize(file.size)}</span>
					<button class="attachment-remove" onclick={() => removeAttachment(i)} title="移除">×</button>
				</div>
			{/each}
		</div>
	{/if}
	<div class="input-row">
		<input
			bind:this={fileInputEl}
			type="file"
			multiple
			accept="image/*,.txt,.md,.py,.js,.ts,.json,.csv,.xml,.yaml,.yml,.toml,.html,.css,.go,.rs,.sh"
			onchange={handleFileChange}
			class="file-input-hidden"
		/>
		<button class="btn-attach" onclick={triggerFileInput} disabled={isStreaming} title="添加附件">
			<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
				<path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
			</svg>
		</button>
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
					disabled={!text.trim() && attachments.length === 0}
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
</div>

<style>
	.input-bar {
		display: flex;
		flex-direction: column;
		padding: var(--space-6) var(--space-10) var(--space-8);
		border-top: 1px solid var(--border);
		background: var(--bg-primary);
	}

	.input-row {
		display: flex;
		align-items: flex-end;
		gap: var(--space-4);
	}

	.file-input-hidden {
		display: none;
	}

	.attachments-preview {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
		margin-bottom: var(--space-4);
	}

	.attachment-chip {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-4);
		background: var(--bg-tertiary);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		font-size: var(--text-xs);
		color: var(--text-secondary);
		max-width: 200px;
	}

	.attachment-icon {
		flex-shrink: 0;
	}

	.attachment-name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.attachment-size {
		flex-shrink: 0;
		color: var(--text-muted);
		font-size: var(--text-2xs);
	}

	.attachment-remove {
		flex-shrink: 0;
		width: var(--size-icon-sm);
		height: var(--size-icon-sm);
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: var(--radius-full);
		font-size: var(--text-base);
		color: var(--text-muted);
		transition: color var(--duration-slow);
	}

	.attachment-remove:hover {
		color: var(--danger);
	}

	.btn-attach {
		width: var(--size-btn-lg);
		height: var(--size-btn-lg);
		border-radius: var(--radius);
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--text-secondary);
		transition: color var(--duration-slow), background var(--duration-slow);
	}

	.btn-attach:hover:not(:disabled) {
		color: var(--accent);
		background: var(--bg-hover);
	}

	.btn-attach:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	textarea {
		flex: 1;
		resize: none;
		padding: var(--space-5) var(--space-7);
		background: var(--bg-input);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		color: var(--text-primary);
		line-height: var(--leading-normal);
		max-height: 200px;
		transition: border-color var(--duration-slow);
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
		gap: var(--space-2);
		padding-bottom: var(--space-1);
	}

	.btn-send,
	.btn-stop {
		width: var(--size-btn-lg);
		height: var(--size-btn-lg);
		border-radius: var(--radius);
		display: flex;
		align-items: center;
		justify-content: center;
		transition: background var(--duration-slow);
	}

	.btn-send {
		background: var(--accent);
		color: var(--text-on-accent);
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
		color: var(--text-on-accent);
	}

	.btn-stop:hover {
		background: var(--danger-hover);
	}
</style>
