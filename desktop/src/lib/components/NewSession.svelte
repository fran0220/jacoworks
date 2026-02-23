<script lang="ts">
	import { selectFolder, folderName, uploadFolder } from '$lib/cowork';
	import { createSession, getContainerStatus, provisionContainer, type ChatSession } from '$lib/sessions';
	import { DEFAULT_MODEL, MODEL_OPTIONS } from '$lib/config';
	import type { AppTab } from '$lib/stores/app.svelte';

	let {
		mode = 'chat',
		onSessionCreated
	}: {
		mode?: AppTab;
		onSessionCreated: (session: ChatSession, firstMessage: string, model: string) => void;
	} = $props();

	let task = $state('');
	let selectedFolder = $state<string | null>(null);
	let model = $state(DEFAULT_MODEL);
	let loading = $state(false);
	let loadingText = $state('');
	let containerReady = $state<boolean | null>(null);
	let provisioning = $state(false);

	let isCowork = $derived(mode === 'cowork');

	// Check container status when switching to cowork mode
	$effect(() => {
		if (isCowork) {
			checkContainer();
		} else {
			containerReady = null;
		}
	});

	async function checkContainer() {
		try {
			const status = await getContainerStatus();
			containerReady = status.provisioned;
		} catch {
			containerReady = false;
		}
	}

	async function handleProvision() {
		provisioning = true;
		loadingText = '正在分配专属容器，请稍等（约30秒）...';
		try {
			const result = await provisionContainer();
			if (result.status === 'ready') {
				containerReady = true;
				loadingText = '';
			} else {
				// Polling: wait and retry
				loadingText = '容器正在启动...';
				for (let i = 0; i < 10; i++) {
					await new Promise(r => setTimeout(r, 3000));
					const status = await getContainerStatus();
					if (status.provisioned && status.container_ip) {
						containerReady = true;
						loadingText = '';
						return;
					}
				}
				loadingText = '';
				alert('容器分配超时，请稍后再试');
			}
		} catch (err: any) {
			loadingText = '';
			alert('容器分配失败: ' + (err.message || err));
		} finally {
			provisioning = false;
		}
	}

	async function handleSelectFolder() {
		const path = await selectFolder();
		if (path) selectedFolder = path;
	}

	async function handleStart() {
		if (!task.trim() || loading) return;
		if (isCowork && !selectedFolder) return;

		loading = true;
		try {
			if (isCowork && selectedFolder) {
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
		{#if isCowork}
			<h1>📂 开始新任务</h1>
			<p class="subtitle">选择项目文件夹，AI 将直接读写你的代码</p>
		{:else}
			<h1>💬 开始新对话</h1>
			<p class="subtitle">与 AI 助手对话，完成日常办公任务</p>
		{/if}
	</div>

	<div class="input-card">
		{#if isCowork && containerReady === false}
			<div class="provision-section">
				<div class="provision-icon">🖥️</div>
				<p class="provision-title">需要分配专属工作容器</p>
				<p class="provision-desc">Cowork 模式需要独立容器来执行代码和操作文件。首次使用需分配，之后自动复用。</p>
				<button
					class="btn-provision"
					onclick={handleProvision}
					disabled={provisioning}
				>
					{#if provisioning}
						<span class="spinner-sm"></span>
						{loadingText}
					{:else}
						分配容器
					{/if}
				</button>
			</div>
		{:else if isCowork}
			<div class="folder-section">
				<button
					class="btn-folder"
					onclick={handleSelectFolder}
					disabled={loading}
				>
					<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
						<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
					</svg>
					{#if selectedFolder}
						<span class="folder-name">{folderName(selectedFolder)}</span>
						<span class="folder-clear" role="button" tabindex="-1" onclick={(e) => { e.stopPropagation(); selectedFolder = null; }} onkeydown={() => {}}>×</span>
					{:else}
						选择项目文件夹
					{/if}
				</button>
				{#if !selectedFolder}
					<span class="folder-hint">必须选择文件夹才能开始</span>
				{/if}
			</div>
		{/if}

		<textarea
			bind:value={task}
			onkeydown={handleKeydown}
			placeholder={isCowork ? '描述你希望 AI 帮你做什么...' : '输入你想聊的内容...'}
			rows={3}
			disabled={loading}
		></textarea>

		<div class="toolbar">
			<div class="left">
				<select bind:value={model} disabled={loading}>
					{#each MODEL_OPTIONS as opt (opt.value)}
						<option value={opt.value}>{opt.label}</option>
					{/each}
				</select>
			</div>

			<div class="right">
				<button
					class="btn-start"
					onclick={handleStart}
					disabled={!task.trim() || loading || (isCowork && !selectedFolder)}
				>
					{#if loading}
						{loadingText || '准备中...'}
					{:else}
						{isCowork ? '开始任务 →' : '开始对话 →'}
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
		padding: var(--space-12) var(--space-10);
		gap: var(--space-11);
	}

	.header {
		text-align: center;
	}

	.header h1 {
		font-size: var(--text-3xl);
		font-weight: var(--font-bold);
		color: var(--text-primary);
		margin: 0;
	}

	.subtitle {
		margin-top: var(--space-4);
		color: var(--text-muted);
		font-size: var(--text-base);
	}

	.input-card {
		width: 100%;
		max-width: var(--content-width);
		border: 1px solid var(--border);
		border-radius: var(--radius-xl);
		padding: var(--space-8);
		background: var(--bg-secondary);
		display: flex;
		flex-direction: column;
		gap: var(--space-6);
	}

	.provision-section {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-5);
		padding: var(--space-8) var(--space-6);
		text-align: center;
	}

	.provision-icon {
		font-size: var(--text-4xl);
	}

	.provision-title {
		font-size: var(--text-lg);
		font-weight: var(--font-semibold);
		color: var(--text-primary);
		margin: 0;
	}

	.provision-desc {
		font-size: var(--text-sm);
		color: var(--text-muted);
		max-width: 360px;
		line-height: var(--leading-relaxed);
		margin: 0;
	}

	.btn-provision {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-3);
		padding: var(--space-4) var(--space-9);
		border-radius: var(--radius);
		background: var(--accent);
		color: var(--text-on-accent);
		font-weight: var(--font-semibold);
		font-size: var(--text-base);
		transition: background var(--duration-slow);
		white-space: nowrap;
	}

	.btn-provision:hover:not(:disabled) {
		background: var(--accent-hover);
	}

	.btn-provision:disabled {
		opacity: 0.7;
		cursor: wait;
	}

	.spinner-sm {
		width: var(--size-spinner-sm, 14px);
		height: var(--size-spinner-sm, 14px);
		border: 1.5px solid var(--text-on-accent);
		border-top-color: transparent;
		border-radius: var(--radius-full);
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		to { transform: rotate(360deg); }
	}

	.folder-section {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding-bottom: var(--space-6);
		border-bottom: 1px solid var(--border);
	}

	.folder-hint {
		font-size: var(--text-xs);
		color: var(--text-muted);
		padding-left: var(--space-2);
	}

	.input-card textarea {
		width: 100%;
		resize: none;
		border: none;
		background: transparent;
		color: var(--text-primary);
		font-size: var(--text-lg);
		line-height: var(--leading-normal);
		outline: none;
		padding: var(--space-2);
	}

	.input-card textarea::placeholder {
		color: var(--text-muted);
	}

	.toolbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-4);
	}

	.left, .right {
		display: flex;
		align-items: center;
		gap: var(--space-4);
	}

	.btn-folder {
		display: flex;
		align-items: center;
		gap: var(--space-4);
		padding: var(--space-5) var(--space-7);
		border-radius: var(--radius);
		border: 1px dashed var(--border);
		color: var(--text-secondary);
		font-size: var(--text-base);
		transition: all var(--duration-slow);
		width: 100%;
	}

	.btn-folder:hover:not(:disabled) {
		background: var(--bg-hover);
		color: var(--text-primary);
		border-color: var(--accent);
	}

	.folder-name {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--accent);
		text-align: left;
	}

	.folder-clear {
		width: var(--space-9);
		height: var(--space-9);
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: var(--radius-full);
		font-size: var(--text-base);
		color: var(--text-muted);
		flex-shrink: 0;
	}

	.folder-clear:hover {
		color: var(--danger);
	}

	select {
		padding: var(--space-3) var(--space-4);
		border-radius: var(--radius);
		border: 1px solid var(--border);
		background: var(--bg-primary);
		color: var(--text-secondary);
		font-size: var(--text-sm);
	}

	.btn-start {
		padding: var(--space-4) var(--space-9);
		border-radius: var(--radius);
		background: var(--accent);
		color: var(--text-on-accent);
		font-weight: var(--font-semibold);
		font-size: var(--text-base);
		transition: background var(--duration-slow);
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
