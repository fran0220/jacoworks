<script lang="ts">
	import { getUser, logout } from '$lib/auth.svelte';

	let { title }: { title: string } = $props();

	let user = $derived(getUser());
</script>

<header class="topbar">
	<h2 class="title">{title}</h2>
	<div class="right">
		{#if user}
			<span class="username">{user.username}</span>
		{/if}
		<button class="btn-logout" onclick={logout}>退出</button>
	</div>
</header>

<style>
	.topbar {
		height: var(--topbar-height);
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0 24px;
		border-bottom: 1px solid var(--border);
		background: var(--bg-primary);
		flex-shrink: 0;
	}

	.title {
		font-size: 15px;
		font-weight: 600;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.right {
		display: flex;
		align-items: center;
		gap: 12px;
	}

	.username {
		font-size: 13px;
		color: var(--text-secondary);
	}

	.btn-logout {
		padding: 6px 14px;
		font-size: 13px;
		color: var(--text-secondary);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		transition: all 0.2s;
	}

	.btn-logout:hover {
		color: var(--danger);
		border-color: var(--danger);
	}
</style>
