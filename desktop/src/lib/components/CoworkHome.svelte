<script lang="ts">
	import { selectFolder, folderName, uploadFolder } from '$lib/cowork';
	import { createSession, type ChatSession } from '$lib/sessions';
	import { DEFAULT_MODEL, MODEL_OPTIONS } from '$lib/config';

	let {
		onSessionCreated
	}: {
		onSessionCreated: (session: ChatSession, firstMessage: string, model: string) => void;
	} = $props();

	let task = $state('');
	let selectedFolder = $state<string | null>(null);
	let model = $state(DEFAULT_MODEL);
	let loading = $state(false);
	let loadingText = $state('');

	const quickTasks = [
		{ icon: '📝', title: '审查合同文档', desc: '上传合同，AI 逐条审查' },
		{ icon: '📊', title: '分析数据报表', desc: '解读 Excel 数据趋势' },
		{ icon: '💻', title: '代码重构优化', desc: '选择项目进行代码改进' },
	];

	async function handleSelectFolder() {
		const path = await selectFolder();
		if (path) selectedFolder = path;
	}

	async function handleStart() {
		if (!task.trim() || !selectedFolder || loading) return;
		loading = true;
		try {
			loadingText = '正在准备文件...';
			const session = await createSession({
				type: 'cowork',
				workspacePath: selectedFolder
			});
			loadingText = '正在上传文件...';
			await uploadFolder(session.id, selectedFolder);
			loadingText = '';
			onSessionCreated(session, task.trim(), model);
		} catch (err: any) {
			loadingText = '';
			alert('创建失败: ' + (err.message || err));
		} finally {
			loading = false;
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey && !loading) {
			e.preventDefault();
			handleStart();
		}
	}
</script>

<div class="cowork-home">
	<div class="header">
		<h1>开始你的工作任务</h1>
		<p class="subtitle">选择项目文件夹，AI 将直接读写你的代码和文件</p>
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
				<button class="btn-folder" onclick={handleSelectFolder} disabled={loading}>
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
						<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
					</svg>
					{#if selectedFolder}
						<span class="folder-name">{folderName(selectedFolder)}</span>
						<!-- svelte-ignore a11y_click_events_have_key_events -->
						<!-- svelte-ignore a11y_no_static_element_interactions -->
						<span class="folder-clear" onclick={(e) => { e.stopPropagation(); selectedFolder = null; }}>×</span>
					{:else}
						选择文件夹
					{/if}
					<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
						<polyline points="6 9 12 15 18 9" />
					</svg>
				</button>
				<span class="btn-attach" title="添加附件">+</span>
			</div>
			<div class="toolbar-right">
				<select bind:value={model} class="model-select" disabled={loading}>
					{#each MODEL_OPTIONS as opt (opt.value)}
						<option value={opt.value}>{opt.label}</option>
					{/each}
				</select>
				<button
					class="btn-start"
					onclick={handleStart}
					disabled={!task.trim() || !selectedFolder || loading}
				>
					{#if loading}
						{loadingText || '准备中…'}
					{:else}
						开始 →
					{/if}
				</button>
			</div>
		</div>
	</div>

	<div class="quick-section">
		<p class="quick-label">快速开始</p>
		<div class="quick-cards">
			{#each quickTasks as t}
				<div class="task-card">
					<span class="task-icon">{t.icon}</span>
					<span class="task-title">{t.title}</span>
					<span class="task-desc">{t.desc}</span>
				</div>
			{/each}
		</div>
	</div>
</div>

<style>
	.cowork-home {
		flex: 1;
		display: flex;
		flex-direction: column;
		padding: var(--space-13) var(--space-14);
		overflow-y: auto;
	}

	.header h1 {
		font-size: var(--text-3xl);
		font-weight: var(--font-bold);
		color: var(--text-primary);
		margin: 0;
	}

	.subtitle {
		font-size: var(--text-base);
		color: var(--text-muted);
		margin-top: var(--space-3);
	}

	.input-card {
		margin-top: var(--space-11);
		max-width: var(--content-width);
		background: var(--bg-secondary);
		border: 1px solid var(--border);
		border-radius: var(--radius-xl);
		padding: var(--space-8) var(--space-8) var(--space-6);
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
		gap: var(--space-4);
	}

	.toolbar-left, .toolbar-right {
		display: flex;
		align-items: center;
		gap: var(--space-5);
	}

	.btn-folder {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-2) var(--space-5);
		font-size: var(--text-sm);
		color: var(--text-muted);
		border-radius: var(--radius-xs);
		transition: all var(--duration-normal);
	}

	.btn-folder:hover:not(:disabled) {
		color: var(--text-secondary);
		background: var(--bg-hover);
	}

	.folder-name {
		max-width: 140px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--accent);
	}

	.folder-clear {
		font-size: var(--text-base);
		color: var(--text-muted);
		cursor: pointer;
		line-height: 1;
	}

	.folder-clear:hover {
		color: var(--danger);
	}

	.btn-attach {
		font-size: var(--size-icon);
		color: var(--text-muted);
		cursor: pointer;
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

	.btn-start {
		padding: var(--space-3) var(--space-8);
		background: var(--accent);
		color: var(--text-on-accent);
		font-size: var(--text-sm);
		font-weight: var(--font-medium);
		border-radius: var(--radius-xl);
		transition: opacity var(--duration-normal);
		white-space: nowrap;
	}

	.btn-start:hover:not(:disabled) {
		opacity: 0.85;
	}

	.btn-start:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.quick-section {
		margin-top: var(--space-11);
		max-width: var(--content-width);
	}

	.quick-label {
		font-size: var(--text-xs);
		color: var(--text-muted);
		margin-bottom: var(--space-5);
	}

	.quick-cards {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: var(--space-5);
	}

	.task-card {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding: var(--space-7);
		background: var(--bg-secondary);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		cursor: pointer;
		transition: all var(--duration-normal);
	}

	.task-card:hover {
		border-color: var(--accent);
		box-shadow: var(--shadow-md);
	}

	.task-icon {
		font-size: var(--size-icon);
		margin-bottom: var(--space-1);
	}

	.task-title {
		font-size: var(--text-sm);
		font-weight: var(--font-semibold);
		color: var(--text-primary);
	}

	.task-desc {
		font-size: var(--text-xs);
		color: var(--text-muted);
	}
</style>
