<script lang="ts">
	import { getUser } from '$lib/auth.svelte';
	import { createSession, type ChatSession } from '$lib/sessions';
	import { DEFAULT_MODEL, MODEL_OPTIONS } from '$lib/config';

	let {
		onSessionCreated
	}: {
		onSessionCreated: (session: ChatSession, firstMessage: string, model: string) => void;
	} = $props();

	let user = $derived(getUser());
	let task = $state('');
	let model = $state(DEFAULT_MODEL);
	let loading = $state(false);

	const quickActions = [
		{ icon: '✏️', label: '写作' },
		{ icon: '📊', label: '分析' },
		{ icon: '🌐', label: '翻译' },
		{ icon: '📧', label: '邮件' },
		{ icon: '💡', label: '灵感' },
	];

	async function handleSend() {
		if (!task.trim() || loading) return;
		loading = true;
		try {
			const session = await createSession();
			onSessionCreated(session, task.trim(), model);
		} catch (err: any) {
			alert('创建失败: ' + (err.message || err));
		} finally {
			loading = false;
			task = '';
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey && !loading) {
			e.preventDefault();
			handleSend();
		}
	}

	function handleQuickAction(label: string) {
		task = `帮我${label}`;
	}
</script>

<div class="chat-home">
	<div class="hero">
		<h1 class="greeting">
			<span class="greeting-icon">✳️</span>
			你好，{user?.name || '用户'}
		</h1>
	</div>

	<div class="input-card">
		<textarea
			bind:value={task}
			onkeydown={handleKeydown}
			placeholder="有什么可以帮你的？"
			rows={1}
			disabled={loading}
		></textarea>
		<div class="toolbar">
			<div class="toolbar-left">
				<span class="btn-attach" title="添加附件">+</span>
			</div>
			<div class="toolbar-right">
				<select bind:value={model} class="model-select" disabled={loading}>
					{#each MODEL_OPTIONS as opt (opt.value)}
						<option value={opt.value}>{opt.label}</option>
					{/each}
				</select>
				<button
					class="btn-send"
					onclick={handleSend}
					disabled={!task.trim() || loading}
					title="发送"
				>
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
						<line x1="12" y1="19" x2="12" y2="5" />
						<polyline points="5 12 12 5 19 12" />
					</svg>
				</button>
			</div>
		</div>
	</div>

	<div class="quick-actions">
		{#each quickActions as action}
			<button class="chip" onclick={() => handleQuickAction(action.label)}>
				<span>{action.icon}</span>
				<span>{action.label}</span>
			</button>
		{/each}
	</div>
</div>

<style>
	.chat-home {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 0 var(--space-10) var(--space-15);
		gap: 0;
	}

	.hero {
		margin-bottom: var(--space-11);
	}

	.greeting {
		font-family: var(--font-serif);
		font-size: var(--text-4xl);
		font-weight: var(--font-normal);
		color: var(--text-primary);
		display: flex;
		align-items: center;
		gap: var(--space-5);
	}

	.greeting-icon {
		font-size: var(--text-3xl);
		color: var(--accent);
	}

	.input-card {
		width: 100%;
		max-width: var(--content-width);
		background: var(--bg-secondary);
		border: 1px solid var(--border);
		border-radius: var(--radius-2xl);
		padding: var(--space-8) var(--space-9) var(--space-6);
		box-shadow: var(--shadow-md);
	}

	.input-card textarea {
		width: 100%;
		resize: none;
		background: transparent;
		color: var(--text-primary);
		font-size: var(--text-md);
		line-height: var(--leading-normal);
		padding: 0;
		min-height: var(--space-10);
	}

	.input-card textarea::placeholder {
		color: var(--text-muted);
	}

	.toolbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-top: var(--space-6);
	}

	.toolbar-left, .toolbar-right {
		display: flex;
		align-items: center;
		gap: var(--space-4);
	}

	.btn-attach {
		font-size: var(--text-xl);
		color: var(--text-muted);
		cursor: pointer;
		line-height: 1;
		transition: color var(--duration-normal);
	}

	.btn-attach:hover {
		color: var(--text-secondary);
	}

	.model-select {
		padding: 0;
		border: none;
		background: none;
		color: var(--text-muted);
		font-size: var(--text-sm);
		cursor: pointer;
		outline: none;
	}

	.btn-send {
		width: var(--size-btn);
		height: var(--size-btn);
		border-radius: var(--radius-full);
		background: var(--accent);
		color: var(--text-on-accent);
		display: flex;
		align-items: center;
		justify-content: center;
		transition: opacity var(--duration-normal);
	}

	.btn-send:hover:not(:disabled) {
		opacity: 0.85;
	}

	.btn-send:disabled {
		opacity: 0.35;
		cursor: not-allowed;
	}

	.quick-actions {
		display: flex;
		gap: var(--space-4);
		margin-top: var(--space-9);
		flex-wrap: wrap;
		justify-content: center;
	}

	.chip {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-3) var(--space-7);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		font-size: var(--text-sm);
		color: var(--text-secondary);
		transition: all var(--duration-normal);
	}

	.chip:hover {
		background: var(--bg-hover);
		border-color: var(--accent);
		color: var(--text-primary);
	}
</style>
