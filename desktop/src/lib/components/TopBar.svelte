<script lang="ts">
	import { getUser, logout } from '$lib/auth.svelte';

	let { title, modelLabel = '' }: { title: string; modelLabel?: string } = $props();

	let user = $derived(getUser());
</script>

<header class="topbar">
	<div class="left">
		<h2 class="title">{title}</h2>
		{#if modelLabel}
			<span class="model-badge">{modelLabel}</span>
		{/if}
	</div>
	<div class="right">
		{#if user}
			<span class="username">{user.name || user.email}</span>
		{/if}
		<button class="btn-logout" onclick={logout}>退出</button>
	</div>
</header>

<style>
	.topbar {
		height: var(--titlebar-height);
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0 var(--space-10);
		border-bottom: 1px solid var(--border);
		background: var(--bg-primary);
		flex-shrink: 0;
	}

	.left {
		display: flex;
		align-items: center;
		gap: var(--space-5);
		min-width: 0;
	}

	.title {
		font-size: var(--text-md);
		font-weight: var(--font-semibold);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.model-badge {
		flex-shrink: 0;
		padding: var(--space-1) var(--space-4);
		font-size: var(--text-2xs);
		color: var(--accent);
		background: var(--bg-badge);
		border-radius: var(--radius-md);
		white-space: nowrap;
	}

	.right {
		display: flex;
		align-items: center;
		gap: var(--space-6);
	}

	.username {
		font-size: var(--text-sm);
		color: var(--text-secondary);
	}

	.btn-logout {
		padding: var(--space-3) var(--space-7);
		font-size: var(--text-sm);
		color: var(--text-secondary);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		transition: all var(--duration-slow);
	}

	.btn-logout:hover {
		color: var(--danger);
		border-color: var(--danger);
	}
</style>
