<script lang="ts">
	import type { ChatSession } from '$lib/sessions';
	import { getUser, logout } from '$lib/auth.svelte';
	import {
		getActiveTab,
		getSidebarOpen,
		setSidebarOpen,
		type AppTab
	} from '$lib/stores/app.svelte';

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

	let open = $derived(getSidebarOpen());
	let activeTab = $derived(getActiveTab());
	let user = $derived(getUser());
	let initial = $derived(user?.name?.charAt(0)?.toUpperCase() || 'U');

	let filteredSessions = $derived(
		sessions.filter((s) => s.type === activeTab)
	);

	function handleNew() {
		onNew();
		setSidebarOpen(false);
	}

	function handleSelect(id: string) {
		onSelect(id);
		setSidebarOpen(false);
	}

	function handleDelete(e: MouseEvent, id: string) {
		e.stopPropagation();
		if (confirm(activeTab === 'chat' ? '确认删除此对话？' : '确认删除此任务？')) {
			onDelete(id);
		}
	}

	function formatDate(ts: number): string {
		const d = new Date(ts);
		const now = new Date();
		if (d.toDateString() === now.toDateString()) {
			return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
		}
		return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
	}
</script>

{#if open}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="backdrop" onclick={() => setSidebarOpen(false)}></div>
{/if}

<aside class="drawer" class:open>
	<div class="drawer-content">
		<div class="top-actions">
			<button class="action-row" onclick={handleNew}>
				<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<line x1="12" y1="5" x2="12" y2="19" />
					<line x1="5" y1="12" x2="19" y2="12" />
				</svg>
				{activeTab === 'chat' ? '新对话' : '新任务'}
			</button>
		</div>

		<div class="divider"></div>

		<div class="section-label">最近</div>

		<div class="session-list">
			{#each filteredSessions as session (session.id)}
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div
					class="session-item"
					class:active={session.id === currentSessionId}
					onclick={() => handleSelect(session.id)}
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
					{activeTab === 'chat' ? '暂无对话记录' : '暂无任务记录'}
				</div>
			{/if}
		</div>

		<div class="bottom">
			<div class="user-info">
				<span class="user-avatar">{initial}</span>
				<span class="user-name">{user?.name || '用户'}</span>
			</div>
			<button class="btn-logout" onclick={logout}>退出</button>
		</div>
	</div>
</aside>

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		z-index: var(--z-backdrop);
	}

	.drawer {
		position: fixed;
		top: 0;
		left: 0;
		width: var(--sidebar-width);
		height: 100vh;
		background: var(--bg-secondary);
		border-right: 1px solid var(--border);
		z-index: var(--z-drawer);
		transform: translateX(-100%);
		transition: transform var(--duration-slow) ease;
	}

	.drawer.open {
		transform: translateX(0);
	}

	.drawer-content {
		display: flex;
		flex-direction: column;
		height: 100%;
		padding-top: var(--titlebar-height);
	}

	.top-actions {
		padding: var(--space-4) var(--space-6);
	}

	.action-row {
		display: flex;
		align-items: center;
		gap: var(--space-4);
		width: 100%;
		padding: var(--space-4) var(--space-6);
		font-size: var(--text-base);
		color: var(--text-primary);
		border-radius: var(--radius-xs);
		transition: background var(--duration-normal);
	}

	.action-row:hover {
		background: var(--bg-hover);
	}

	.divider {
		height: 1px;
		background: var(--border-light);
		margin: var(--space-2) var(--space-6);
	}

	.section-label {
		padding: var(--space-5) var(--space-10) var(--space-2);
		font-size: var(--text-2xs);
		color: var(--text-muted);
		text-transform: uppercase;
		letter-spacing: 0.5px;
	}

	.session-list {
		flex: 1;
		overflow-y: auto;
		padding: 0 var(--space-4);
	}

	.session-item {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: var(--space-4) var(--space-6);
		border-radius: var(--radius-xs);
		cursor: pointer;
		transition: background var(--duration-fast);
		gap: var(--space-4);
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
		color: var(--text-secondary);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.session-item.active .session-title {
		color: var(--text-primary);
		font-weight: var(--font-medium);
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
		width: var(--size-delete-btn);
		height: var(--size-delete-btn);
		border-radius: var(--radius-sm);
		font-size: var(--text-base);
		line-height: 1;
		color: var(--text-muted);
		opacity: 0;
		transition: all var(--duration-fast);
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

	.bottom {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: var(--space-5) var(--space-8);
		border-top: 1px solid var(--border-light);
	}

	.user-info {
		display: flex;
		align-items: center;
		gap: var(--space-4);
	}

	.user-avatar {
		width: var(--size-avatar-sm);
		height: var(--size-avatar-sm);
		border-radius: var(--radius-full);
		background: var(--accent);
		color: var(--text-on-accent);
		font-size: var(--text-2xs);
		font-weight: var(--font-semibold);
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.user-name {
		font-size: var(--text-sm);
		color: var(--text-primary);
	}

	.btn-logout {
		font-size: var(--text-xs);
		color: var(--text-muted);
		transition: color var(--duration-normal);
	}

	.btn-logout:hover {
		color: var(--danger);
	}
</style>
