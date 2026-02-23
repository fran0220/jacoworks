<script lang="ts">
	import { login, loginWithFeishu, activateWithCode } from '$lib/auth.svelte';

	let mode = $state<'login' | 'activate'>('login');
	let email = $state('');
	let password = $state('');
	let code = $state('');
	let username = $state('');
	let newPassword = $state('');
	let error = $state('');
	let loading = $state(false);

	async function handleLogin(e: Event) {
		e.preventDefault();
		if (!email || !password) return;
		error = '';
		loading = true;
		try {
			await login(email, password);
		} catch (err: any) {
			error = err.message || '登录失败';
		} finally {
			loading = false;
		}
	}

	async function handleActivate(e: Event) {
		e.preventDefault();
		if (!code || !username || !newPassword) return;
		error = '';
		loading = true;
		try {
			await activateWithCode(code, username, newPassword);
		} catch (err: any) {
			error = err.message || '激活失败';
		} finally {
			loading = false;
		}
	}

	async function handleFeishu() {
		error = '';
		loading = true;
		try {
			await loginWithFeishu();
		} catch (err: any) {
			error = err.message || '飞书登录失败';
		} finally {
			loading = false;
		}
	}
</script>

<div class="login-wrapper">
	<form class="login-card" onsubmit={mode === 'login' ? handleLogin : handleActivate}>
		<h1 class="logo">JAcoworks AI</h1>
		<p class="subtitle">企业 AI 协同办公平台</p>

		{#if error}
			<div class="error">{error}</div>
		{/if}

		<div class="tabs">
			<button
				type="button"
				class="tab"
				class:active={mode === 'login'}
				onclick={() => { mode = 'login'; error = ''; }}
			>登录</button>
			<button
				type="button"
				class="tab"
				class:active={mode === 'activate'}
				onclick={() => { mode = 'activate'; error = ''; }}
			>激活码</button>
		</div>

		{#if mode === 'login'}
			<input
				type="email"
				placeholder="邮箱"
				bind:value={email}
				disabled={loading}
				autocomplete="email"
			/>
			<input
				type="password"
				placeholder="密码"
				bind:value={password}
				disabled={loading}
				autocomplete="current-password"
			/>
			<button type="submit" class="btn-primary" disabled={loading || !email || !password}>
				{loading ? '登录中…' : '登录'}
			</button>
		{:else}
			<input
				type="text"
				placeholder="激活码"
				bind:value={code}
				disabled={loading}
			/>
			<input
				type="text"
				placeholder="用户名"
				bind:value={username}
				disabled={loading}
				autocomplete="username"
			/>
			<input
				type="password"
				placeholder="设置密码"
				bind:value={newPassword}
				disabled={loading}
				autocomplete="new-password"
			/>
			<button type="submit" class="btn-primary" disabled={loading || !code || !username || !newPassword}>
				{loading ? '激活中…' : '激活并登录'}
			</button>
		{/if}

		<div class="divider"><span>或</span></div>

		<button type="button" class="btn-feishu" onclick={handleFeishu} disabled={loading}>
			<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
				<path d="M3.3 4.1L9.8 1l3 5.5L6.5 12l-3.2-7.9zm17.4 0L14.2 1l-3 5.5L17.5 12l3.2-7.9zM12 23l-7-11h14l-7 11z"/>
			</svg>
			飞书 SSO 登录
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
		width: var(--login-width);
		padding: var(--space-13) var(--space-11);
		background: var(--bg-secondary);
		border-radius: var(--radius-lg);
		border: 1px solid var(--border);
		display: flex;
		flex-direction: column;
		gap: var(--space-7);
	}

	.logo {
		text-align: center;
		font-size: var(--text-2xl);
		font-weight: var(--font-bold);
		color: var(--accent);
	}

	.subtitle {
		text-align: center;
		color: var(--text-secondary);
		font-size: var(--text-sm);
		margin-bottom: var(--space-2);
	}

	.error {
		padding: var(--space-5) var(--space-6);
		background: var(--bg-error);
		border: 1px solid var(--danger);
		border-radius: var(--radius);
		color: var(--danger);
		font-size: var(--text-sm);
	}

	.tabs {
		display: flex;
		gap: 0;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		overflow: hidden;
	}

	.tab {
		flex: 1;
		padding: var(--space-4);
		font-size: var(--text-sm);
		font-weight: var(--font-medium);
		color: var(--text-secondary);
		background: var(--bg-primary);
		transition: all var(--duration-slow);
	}

	.tab.active {
		background: var(--accent);
		color: var(--text-on-accent);
	}

	input {
		padding: var(--space-6) var(--space-7);
		background: var(--bg-input);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		color: var(--text-primary);
		transition: border-color var(--duration-slow);
	}

	input:focus {
		border-color: var(--accent);
	}

	input:disabled {
		opacity: 0.6;
	}

	.btn-primary {
		padding: var(--space-6);
		background: var(--accent);
		color: var(--text-on-accent);
		border-radius: var(--radius);
		font-weight: var(--font-semibold);
		transition: background var(--duration-slow);
	}

	.btn-primary:hover:not(:disabled) {
		background: var(--accent-hover);
	}

	.btn-primary:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.divider {
		display: flex;
		align-items: center;
		gap: var(--space-6);
		color: var(--text-muted);
		font-size: var(--text-xs);
	}

	.divider::before,
	.divider::after {
		content: '';
		flex: 1;
		height: 1px;
		background: var(--border);
	}

	.btn-feishu {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-4);
		padding: var(--space-6);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		color: var(--text-primary);
		font-weight: var(--font-medium);
		transition: all var(--duration-slow);
	}

	.btn-feishu:hover:not(:disabled) {
		background: var(--bg-hover);
		border-color: var(--accent);
	}

	.btn-feishu:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
</style>
