<script lang="ts">
	let { toolName }: { toolName: string } = $props();

	const toolLabels: Record<string, string> = {
		web_search: '🔍 正在搜索网页…',
		web_fetch: '🌐 正在读取网页…',
		read: '📄 正在读取文件…',
		write: '✏️ 正在写入文件…',
		edit: '✏️ 正在编辑文件…',
		bash: '⚙️ 正在执行命令…',
		grep: '🔍 正在搜索内容…',
		find: '📂 正在查找文件…',
		ls: '📂 正在列出目录…',
		memory_search: '🧠 正在搜索记忆…',
		memory_save: '🧠 正在保存记忆…',
		cron_manage: '⏰ 正在管理定时任务…',
	};

	let label = $derived(toolLabels[toolName] || `🔧 正在使用 ${toolName}…`);
</script>

<div class="tool-status">
	<span class="spinner"></span>
	<span class="label">{label}</span>
</div>

<style>
	.tool-status {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		padding: 6px 16px;
		margin: 4px 24px;
		background: var(--bg-tertiary);
		opacity: 0.85;
		border-radius: var(--radius);
		font-size: 12px;
		color: var(--text-secondary);
	}

	.spinner {
		width: 14px;
		height: 14px;
		border: 2px solid var(--border);
		border-top-color: var(--accent);
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	.label {
		white-space: nowrap;
	}
</style>
