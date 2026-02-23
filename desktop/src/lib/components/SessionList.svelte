<script lang="ts">
	import type { ChatSession } from '$lib/sessions';
	import type { AppTab } from '$lib/stores/app.svelte';

	let {
		sessions,
		currentSessionId,
		activeTab,
		onSelect,
		onNew,
		onDelete,
		onTabChange
	}: {
		sessions: ChatSession[];
		currentSessionId: string | null;
		activeTab: AppTab;
		onSelect: (id: string) => void;
		onNew: () => void;
		onDelete: (id: string) => void;
		onTabChange: (tab: AppTab) => void;
	} = $props();

	let filteredSessions = $derived(
		sessions.filter((s) => s.type === activeTab)
	);

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
	<div class="tab-bar">
		<button
			class="tab-item"
			class:active={activeTab === 'chat'}
			onclick={() => onTabChange('chat')}
		>
			<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
				<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
			</svg>
			对话
		</button>
		<button
			class="tab-item"
			class:active={activeTab === 'cowork'}
			onclick={() => onTabChange('cowork')}
		>
			<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
				<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
			</svg>
			工作协助
		</button>
	</div>

	<button class="btn-new" onclick={onNew}>
		<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
			<line x1="12" y1="5" x2="12" y2="19" />
			<line x1="5" y1="12" x2="19" y2="12" />
		</svg>
		{activeTab === 'chat' ? '新对话' : '新任务'}
	</button>

	<div class="session-list">
		{#each filteredSessions as session (session.id)}
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="session-item"
				class:active={session.id === currentSessionId}
				onclick={() => onSelect(session.id)}
			>
				<span class="session-title">{session.title}</span>
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

		{#if filteredSessions.length === 0}
			<div class="empty-hint">
				{activeTab === 'chat' ? '暂无对话' : '暂无任务'}
			</div>
		{/if}
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

	.tab-bar {
		display: flex;
		padding: var(--space-4) var(--space-4) 0;
		gap: var(--space-2);
	}

	.tab-item {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-3);
		padding: var(--space-4) 0;
		font-size: var(--text-sm);
		font-weight: var(--font-medium);
		color: var(--text-muted);
		border-radius: var(--radius) var(--radius) 0 0;
		border-bottom: 2px solid transparent;
		transition: all var(--duration-slow);
	}

	.tab-item:hover {
		color: var(--text-secondary);
		background: var(--bg-hover);
	}

	.tab-item.active {
		color: var(--accent);
		border-bottom-color: var(--accent);
	}

	.btn-new {
		display: flex;
		align-items: center;
		gap: var(--space-4);
		margin: var(--space-6);
		padding: var(--space-5) var(--space-8);
		background: var(--accent);
		color: var(--text-on-accent);
		border-radius: var(--radius);
		font-weight: var(--font-medium);
		transition: background var(--duration-slow);
	}

	.btn-new:hover {
		background: var(--accent-hover);
	}

	.session-list {
		flex: 1;
		overflow-y: auto;
		padding: 0 var(--space-4) var(--space-4);
	}

	.session-item {
		display: flex;
		align-items: center;
		justify-content: space-between;
		width: 100%;
		padding: var(--space-5) var(--space-6);
		border-radius: var(--radius);
		text-align: left;
		transition: background var(--duration-normal);
		gap: var(--space-4);
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
		font-size: var(--text-sm);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.session-meta {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		flex-shrink: 0;
	}

	.session-date {
		font-size: var(--text-2xs);
		color: var(--text-muted);
	}

	.btn-delete {
		width: var(--space-9);
		height: var(--space-9);
		border-radius: var(--radius-sm);
		font-size: var(--text-base);
		line-height: 1;
		color: var(--text-muted);
		opacity: 0;
		transition: all var(--duration-normal);
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.session-item:hover .btn-delete {
		opacity: 1;
	}

	.btn-delete:hover {
		background: var(--danger);
		color: var(--text-on-accent);
	}

	.empty-hint {
		padding: var(--space-10) var(--space-6);
		text-align: center;
		font-size: var(--text-sm);
		color: var(--text-muted);
	}
</style>
