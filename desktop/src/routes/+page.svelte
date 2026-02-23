<script lang="ts">
	import { isAuthenticated, handleOAuthCallback } from '$lib/auth.svelte';
	import { onMount } from 'svelte';
	import LoginPage from '$lib/components/LoginPage.svelte';
	import SessionList from '$lib/components/SessionList.svelte';
	import ChatView from '$lib/components/ChatView.svelte';
	import NewSession from '$lib/components/NewSession.svelte';
	import TopBar from '$lib/components/TopBar.svelte';
	import {
		getCurrentSessionId,
		setCurrentSessionId,
		getSessions,
		setSessions,
		getActiveTab,
		setActiveTab,
		type AppTab
	} from '$lib/stores/app.svelte';
	import {
		listSessions,
		deleteSession,
		getSession,
		type ChatSession
	} from '$lib/sessions';
	import { MODEL_OPTIONS, DEFAULT_MODEL } from '$lib/config';

	let currentSession = $state<ChatSession | null>(null);
	let pendingMessage = $state<string | null>(null);

	// Handle OAuth callback (Feishu SSO redirect with token in URL)
	onMount(async () => {
		try {
			await handleOAuthCallback();
		} catch (err: any) {
			console.error('OAuth callback error:', err.message);
		}
	});

	let sessionId = $derived(getCurrentSessionId());
	let sessions = $derived(getSessions());
	let activeTab = $derived(getActiveTab());
	let sessionTitle = $derived(currentSession?.title ?? (activeTab === 'chat' ? '新对话' : '新任务'));
	let currentModel = $derived(currentSession?.model || DEFAULT_MODEL);
	let currentModelLabel = $derived(MODEL_OPTIONS.find(m => m.value === currentModel)?.label ?? '');

	$effect(() => {
		if (isAuthenticated()) {
			loadSessions();
		}
	});

	$effect(() => {
		const id = getCurrentSessionId();
		if (id) {
			loadCurrentSession(id);
		} else {
			currentSession = null;
		}
	});

	async function loadSessions() {
		setSessions(await listSessions());
	}

	async function loadCurrentSession(id: string) {
		const s = await getSession(id);
		if (s) currentSession = s;
	}

	function handleNew() {
		setCurrentSessionId(null);
	}

	async function handleSelect(id: string) {
		setCurrentSessionId(id);
	}

	async function handleDelete(id: string) {
		await deleteSession(id);
		const remaining = getSessions().filter((s) => s.id !== id);
		setSessions(remaining);
		if (getCurrentSessionId() === id) {
			// Select next session of same type, or clear
			const sameType = remaining.filter((s) => s.type === getActiveTab());
			setCurrentSessionId(sameType.length > 0 ? sameType[0].id : null);
		}
	}

	async function handleSessionUpdate() {
		await loadSessions();
		const id = getCurrentSessionId();
		if (id) await loadCurrentSession(id);
	}

	function handleSessionCreated(session: ChatSession, firstMessage: string, selectedModel: string) {
		session.model = selectedModel;
		setSessions([session, ...getSessions()]);
		setCurrentSessionId(session.id);
		pendingMessage = firstMessage;
	}

	function handleTabChange(tab: AppTab) {
		setActiveTab(tab);
		// Clear selection when switching tabs
		setCurrentSessionId(null);
	}
</script>

{#if !isAuthenticated()}
	<LoginPage />
{:else}
	<div class="app-layout">
		<SessionList
			sessions={sessions}
			currentSessionId={sessionId}
			{activeTab}
			onSelect={handleSelect}
			onNew={handleNew}
			onDelete={handleDelete}
			onTabChange={handleTabChange}
		/>
		<div class="main-area">
			<TopBar title={sessionTitle} modelLabel={currentSession ? currentModelLabel : ''} />
			{#if currentSession}
				<ChatView
					session={currentSession}
					onSessionUpdate={handleSessionUpdate}
					{pendingMessage}
					onPendingMessageSent={() => pendingMessage = null}
				/>
			{:else}
				<NewSession mode={activeTab} onSessionCreated={handleSessionCreated} />
			{/if}
		</div>
	</div>
{/if}

<style>
	.app-layout {
		display: flex;
		height: 100vh;
		overflow: hidden;
	}

	.main-area {
		flex: 1;
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
</style>
