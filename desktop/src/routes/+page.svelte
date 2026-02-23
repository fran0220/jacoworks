<script lang="ts">
	import { isAuthenticated } from '$lib/auth.svelte';
	import LoginPage from '$lib/components/LoginPage.svelte';
	import SessionList from '$lib/components/SessionList.svelte';
	import ChatView from '$lib/components/ChatView.svelte';
	import TopBar from '$lib/components/TopBar.svelte';
	import {
		getCurrentSessionId,
		setCurrentSessionId,
		getSessions,
		setSessions,
		getIsStreaming
	} from '$lib/stores/app.svelte';
	import {
		createSession,
		listSessions,
		deleteSession,
		getSession,
		type ChatSession
	} from '$lib/sessions';

	let currentSession = $state<ChatSession | null>(null);

	let sessionId = $derived(getCurrentSessionId());
	let sessions = $derived(getSessions());
	let sessionTitle = $derived(currentSession?.title ?? '新对话');

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

	async function handleNew() {
		const s = await createSession();
		setSessions([s, ...getSessions()]);
		setCurrentSessionId(s.id);
	}

	async function handleSelect(id: string) {
		setCurrentSessionId(id);
	}

	async function handleDelete(id: string) {
		await deleteSession(id);
		const remaining = getSessions().filter((s) => s.id !== id);
		setSessions(remaining);
		if (getCurrentSessionId() === id) {
			setCurrentSessionId(remaining.length > 0 ? remaining[0].id : null);
		}
	}

	async function handleSessionUpdate() {
		await loadSessions();
		const id = getCurrentSessionId();
		if (id) await loadCurrentSession(id);
	}
</script>

{#if !isAuthenticated()}
	<LoginPage />
{:else}
	<div class="app-layout">
		<SessionList
			sessions={sessions}
			currentSessionId={sessionId}
			onSelect={handleSelect}
			onNew={handleNew}
			onDelete={handleDelete}
		/>
		<div class="main-area">
			<TopBar title={sessionTitle} />
			<ChatView session={currentSession} onSessionUpdate={handleSessionUpdate} />
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
