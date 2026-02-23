<script lang="ts">
	import type { ChatSession } from '$lib/sessions';

	let {
		sessions,
		currentSessionId,
		onSelect,
		onNew,
		onDelete
	}: {
		sessions: ChatSession[];
		currentSessionId: string | null;
		onSelect: (id: string) => void;
		onNew: () => void;
		onDelete: (id: string) => void;
	} = $props();

	function formatDate(ts: number): string {
		const d = new Date(ts);
		const now = new Date();
		if (d.toDateString() === now.toDateString()) {
			return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
		}
		return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
	}

	function handleDelete(e: MouseEvent, id: string) {
		e.stopPropagation();
		if (confirm('确认删除此对话？')) {
			onDelete(id);
		}
	}
</script>

<aside class="sidebar">
	<button class="btn-new" onclick={onNew}>
		<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
			<line x1="12" y1="5" x2="12" y2="19" />
			<line x1="5" y1="12" x2="19" y2="12" />
		</svg>
		新对话
	</button>

	<div class="session-list">
		{#each sessions as session (session.id)}
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="session-item"
				class:active={session.id === currentSessionId}
				onclick={() => onSelect(session.id)}
			>
				<span class="session-title">{#if session.type === 'cowork'}📂 {/if}{session.title}</span>
				<span class="session-meta">
					<span class="session-date">{formatDate(session.updatedAt)}</span>
					<button
						class="btn-delete"
						onclick={(e) => handleDelete(e, session.id)}
						title="删除"
					>×</button>
				</span>
			</div>
		{/each}
	</div>
</aside>

<style>
	.sidebar {
		width: var(--sidebar-width);
		height: 100vh;
		background: var(--bg-secondary);
		border-right: 1px solid var(--border);
		display: flex;
		flex-direction: column;
		flex-shrink: 0;
	}

	.btn-new {
		display: flex;
		align-items: center;
		gap: 8px;
		margin: 12px;
		padding: 10px 16px;
		background: var(--accent);
		color: #fff;
		border-radius: var(--radius);
		font-weight: 500;
		transition: background 0.2s;
	}

	.btn-new:hover {
		background: var(--accent-hover);
	}

	.session-list {
		flex: 1;
		overflow-y: auto;
		padding: 0 8px 8px;
	}

	.session-item {
		display: flex;
		align-items: center;
		justify-content: space-between;
		width: 100%;
		padding: 10px 12px;
		border-radius: var(--radius);
		text-align: left;
		transition: background 0.15s;
		gap: 8px;
		cursor: pointer;
	}

	.session-item:hover {
		background: var(--bg-hover);
	}

	.session-item.active {
		background: var(--bg-active);
	}

	.session-title {
		flex: 1;
		font-size: 13px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.session-meta {
		display: flex;
		align-items: center;
		gap: 4px;
		flex-shrink: 0;
	}

	.session-date {
		font-size: 11px;
		color: var(--text-muted);
	}

	.btn-delete {
		width: 20px;
		height: 20px;
		border-radius: 4px;
		font-size: 14px;
		line-height: 1;
		color: var(--text-muted);
		opacity: 0;
		transition: all 0.15s;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.session-item:hover .btn-delete {
		opacity: 1;
	}

	.btn-delete:hover {
		background: var(--danger);
		color: #fff;
	}
</style>
