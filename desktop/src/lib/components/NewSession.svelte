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

	async function handleSelectFolder() {
		const path = await selectFolder();
		if (path) selectedFolder = path;
	}

	async function handleStart() {
		if (!task.trim() || loading) return;

		loading = true;
		try {
			if (selectedFolder) {
				loadingText = '正在准备文件...';
				const session = await createSession({
					type: 'cowork',
					workspacePath: selectedFolder
				});

				loadingText = '正在上传文件...';
				await uploadFolder(session.id, selectedFolder);

				loadingText = '';
				onSessionCreated(session, task.trim(), model);
			} else {
				const session = await createSession();
				onSessionCreated(session, task.trim(), model);
			}
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

<div class="new-session">
	<div class="header">
		<h1>开始新任务</h1>
		<p class="subtitle">选择文件夹进入 Cowork 模式，或直接对话</p>
	</div>

	<div class="input-card">
		<textarea
			bind:value={task}
			onkeydown={handleKeydown}
			placeholder="描述你要做什么..."
			rows={3}
			disabled={loading}
		></textarea>

		<div class="toolbar">
			<div class="left">
				<button
					class="btn-folder"
					onclick={handleSelectFolder}
					disabled={loading}
				>
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
						<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
					</svg>
					{#if selectedFolder}
						<span class="folder-name">{folderName(selectedFolder)}</span>
						<button class="folder-clear" onclick={(e) => { e.stopPropagation(); selectedFolder = null; }}>×</button>
					{:else}
						选择文件夹
					{/if}
				</button>
			</div>

			<div class="right">
				<select bind:value={model} disabled={loading}>
					{#each MODEL_OPTIONS as opt (opt.value)}
						<option value={opt.value}>{opt.label}</option>
					{/each}
				</select>

				<button
					class="btn-start"
					onclick={handleStart}
					disabled={!task.trim() || loading}
				>
					{#if loading}
						{loadingText || '准备中...'}
					{:else}
						开始 →
					{/if}
				</button>
			</div>
		</div>
	</div>
</div>

<style>
	.new-session {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 40px 24px;
		gap: 32px;
	}

	.header {
		text-align: center;
	}

	.header h1 {
		font-size: 28px;
		font-weight: 700;
		color: var(--text-primary);
		margin: 0;
	}

	.subtitle {
		margin-top: 8px;
		color: var(--text-muted);
		font-size: 14px;
	}

	.input-card {
		width: 100%;
		max-width: 640px;
		border: 1px solid var(--border);
		border-radius: 16px;
		padding: 16px;
		background: var(--bg-secondary);
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.input-card textarea {
		width: 100%;
		resize: none;
		border: none;
		background: transparent;
		color: var(--text-primary);
		font-size: 16px;
		line-height: 1.5;
		outline: none;
		padding: 4px;
	}

	.input-card textarea::placeholder {
		color: var(--text-muted);
	}

	.toolbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
	}

	.left, .right {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.btn-folder {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 6px 12px;
		border-radius: var(--radius);
		color: var(--text-secondary);
		font-size: 13px;
		transition: background 0.2s, color 0.2s;
	}

	.btn-folder:hover:not(:disabled) {
		background: var(--bg-hover);
		color: var(--text-primary);
	}

	.folder-name {
		max-width: 150px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--accent);
	}

	.folder-clear {
		width: 16px;
		height: 16px;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 50%;
		font-size: 14px;
		color: var(--text-muted);
	}

	.folder-clear:hover {
		color: var(--danger);
	}

	select {
		padding: 6px 8px;
		border-radius: var(--radius);
		border: 1px solid var(--border);
		background: var(--bg-primary);
		color: var(--text-secondary);
		font-size: 13px;
	}

	.btn-start {
		padding: 8px 20px;
		border-radius: var(--radius);
		background: var(--accent);
		color: #fff;
		font-weight: 600;
		font-size: 14px;
		transition: background 0.2s;
		white-space: nowrap;
	}

	.btn-start:hover:not(:disabled) {
		background: var(--accent-hover);
	}

	.btn-start:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
</style>
