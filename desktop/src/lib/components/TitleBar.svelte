<script lang="ts">
	import { getUser, logout } from '$lib/auth.svelte';
	import { getActiveTab, setActiveTab, toggleSidebar, type AppTab } from '$lib/stores/app.svelte';

	let activeTab = $derived(getActiveTab());
	let user = $derived(getUser());
	let initial = $derived(user?.name?.charAt(0)?.toUpperCase() || 'U');
	let showMenu = $state(false);

	function switchTab(tab: AppTab) {
		setActiveTab(tab);
	}

	function handleAvatarClick() {
		showMenu = !showMenu;
	}

	function handleLogout() {
		showMenu = false;
		logout();
	}
</script>

<header class="titlebar">
	<div class="left">
		<button class="btn-sidebar" onclick={toggleSidebar} title="切换侧栏">
			<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
				<rect x="3" y="3" width="7" height="18" rx="1" />
				<rect x="14" y="3" width="7" height="18" rx="1" />
			</svg>
		</button>
	</div>

	<div class="center">
		<div class="tab-switcher">
			<button
				class="tab"
				class:active={activeTab === 'chat'}
				onclick={() => switchTab('chat')}
			>对话</button>
			<button
				class="tab"
				class:active={activeTab === 'cowork'}
				onclick={() => switchTab('cowork')}
			>工作协助</button>
		</div>
	</div>

	<div class="right">
		<div class="avatar-wrapper">
			<button class="avatar" onclick={handleAvatarClick} title={user?.name || ''}>
				{initial}
			</button>
			{#if showMenu}
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div class="dropdown" onclick|stopPropagation>
					<div class="dropdown-user">
						<span class="dropdown-name">{user?.name || '用户'}</span>
						<span class="dropdown-email">{user?.email || ''}</span>
					</div>
					<button class="dropdown-item" onclick={handleLogout}>退出登录</button>
				</div>
			{/if}
		</div>
	</div>
</header>

{#if showMenu}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="overlay" onclick={() => showMenu = false}></div>
{/if}

<style>
	.titlebar {
		height: var(--titlebar-height);
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0 var(--space-8);
		border-bottom: 1px solid var(--border-light);
		background: var(--bg-primary);
		flex-shrink: 0;
		position: relative;
		z-index: var(--z-titlebar);
		-webkit-app-region: drag;
	}

	.left, .right {
		width: var(--space-15);
		display: flex;
		align-items: center;
		-webkit-app-region: no-drag;
	}

	.right {
		justify-content: flex-end;
	}

	.center {
		-webkit-app-region: no-drag;
	}

	.btn-sidebar {
		width: var(--size-btn);
		height: var(--size-btn);
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: var(--radius-xs);
		color: var(--text-muted);
		transition: all var(--duration-normal);
	}

	.btn-sidebar:hover {
		background: var(--bg-hover);
		color: var(--text-secondary);
	}

	.tab-switcher {
		display: flex;
		background: var(--bg-secondary);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: var(--space-1);
	}

	.tab {
		padding: var(--space-2) var(--space-8);
		font-size: var(--text-sm);
		font-weight: var(--font-normal);
		color: var(--text-muted);
		border-radius: var(--radius-xs);
		transition: all var(--duration-normal);
		white-space: nowrap;
	}

	.tab:hover:not(.active) {
		color: var(--text-secondary);
	}

	.tab.active {
		background: var(--bg-primary);
		color: var(--text-primary);
		font-weight: var(--font-semibold);
		box-shadow: var(--shadow-sm);
	}

	.avatar-wrapper {
		position: relative;
	}

	.avatar {
		width: var(--size-avatar);
		height: var(--size-avatar);
		border-radius: var(--radius-full);
		background: var(--accent);
		color: var(--text-on-accent);
		font-size: var(--text-xs);
		font-weight: var(--font-semibold);
		display: flex;
		align-items: center;
		justify-content: center;
		transition: opacity var(--duration-normal);
	}

	.avatar:hover {
		opacity: 0.85;
	}

	.dropdown {
		position: absolute;
		top: calc(var(--size-avatar) + var(--space-4));
		right: 0;
		width: 200px;
		background: var(--bg-secondary);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		box-shadow: var(--shadow-md);
		z-index: var(--z-dropdown);
		overflow: hidden;
	}

	.dropdown-user {
		padding: var(--space-6) var(--space-7);
		border-bottom: 1px solid var(--border-light);
	}

	.dropdown-name {
		display: block;
		font-size: var(--text-sm);
		font-weight: var(--font-semibold);
		color: var(--text-primary);
	}

	.dropdown-email {
		display: block;
		font-size: var(--text-xs);
		color: var(--text-muted);
		margin-top: var(--space-1);
	}

	.dropdown-item {
		display: block;
		width: 100%;
		padding: var(--space-5) var(--space-7);
		font-size: var(--text-sm);
		color: var(--text-secondary);
		text-align: left;
		transition: background var(--duration-normal);
	}

	.dropdown-item:hover {
		background: var(--bg-hover);
		color: var(--danger);
	}

	.overlay {
		position: fixed;
		inset: 0;
		z-index: var(--z-overlay);
	}
</style>
