<script lang="ts">
	import { login } from '$lib/auth.svelte';

	let username = $state('');
	let password = $state('');
	let error = $state('');
	let loading = $state(false);

	async function handleLogin(e: Event) {
		e.preventDefault();
		if (!username || !password) return;

		error = '';
		loading = true;
		try {
			await login(username, password);
		} catch (err: any) {
			error = err.message || '登录失败';
		} finally {
			loading = false;
		}
	}
</script>

<div class="login-wrapper">
	<form class="login-card" onsubmit={handleLogin}>
		<h1 class="logo">JAcoworks AI</h1>
		<p class="subtitle">企业 AI 协同办公平台</p>

		{#if error}
			<div class="error">{error}</div>
		{/if}

		<input
			type="text"
			placeholder="用户名"
			bind:value={username}
			disabled={loading}
			autocomplete="username"
		/>
		<input
			type="password"
			placeholder="密码"
			bind:value={password}
			disabled={loading}
			autocomplete="current-password"
		/>
		<button type="submit" class="btn-login" disabled={loading || !username || !password}>
			{loading ? '登录中…' : '登录'}
		</button>
	</form>
</div>

<style>
	.login-wrapper {
		height: 100vh;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--bg-primary);
	}

	.login-card {
		width: 360px;
		padding: 48px 36px;
		background: var(--bg-secondary);
		border-radius: var(--radius-lg);
		border: 1px solid var(--border);
		display: flex;
		flex-direction: column;
		gap: 16px;
	}

	.logo {
		text-align: center;
		font-size: 24px;
		font-weight: 700;
		color: var(--accent);
	}

	.subtitle {
		text-align: center;
		color: var(--text-secondary);
		font-size: 13px;
		margin-bottom: 8px;
	}

	.error {
		padding: 10px 12px;
		background: rgba(224, 80, 80, 0.15);
		border: 1px solid var(--danger);
		border-radius: var(--radius);
		color: var(--danger);
		font-size: 13px;
	}

	input {
		padding: 12px 14px;
		background: var(--bg-input);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		color: var(--text-primary);
		transition: border-color 0.2s;
	}

	input:focus {
		border-color: var(--accent);
	}

	input:disabled {
		opacity: 0.6;
	}

	.btn-login {
		padding: 12px;
		background: var(--accent);
		color: #fff;
		border-radius: var(--radius);
		font-weight: 600;
		transition: background 0.2s;
	}

	.btn-login:hover:not(:disabled) {
		background: var(--accent-hover);
	}

	.btn-login:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
</style>
