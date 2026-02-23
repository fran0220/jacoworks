import { GATEWAY_URL } from './config';
import { getToken } from './auth.svelte';

export interface MessageContent {
	type: 'text' | 'image_url';
	text?: string;
	image_url?: { url: string };
}

export interface ChatMessage {
	role: 'system' | 'user' | 'assistant';
	content: string | MessageContent[];
}

export interface AttachedFile {
	name: string;
	type: 'image' | 'text';
	data: string;
	size: number;
}

export interface ChatSession {
	id: string;
	title: string;
	messages: ChatMessage[];
	createdAt: number;
	updatedAt: number;
	type: 'chat' | 'cowork';
	workspacePath: string;
	model: string;
}

interface SessionSummary {
	id: string;
	title: string;
	message_count: number;
	created_at: number;
	updated_at: number;
	type?: string;
	workspace_path?: string;
}

interface ServerSession {
	id: string;
	user_id: number;
	title: string;
	messages: string; // JSON string
	created_at: number;
	updated_at: number;
	type?: string;
	workspace_path?: string;
}

function isTauri(): boolean {
	return typeof window !== 'undefined' && '__TAURI__' in window;
}

async function apiFetch(path: string, options: { method?: string; body?: string } = {}): Promise<{ status: number; body: string }> {
	const token = getToken();
	const headers: Record<string, string> = {
		'Content-Type': 'application/json',
		Authorization: `Bearer ${token}`
	};

	if (isTauri()) {
		const { invoke } = await import('@tauri-apps/api/core');
		return invoke('http_fetch', {
			url: `${GATEWAY_URL}${path}`,
			method: options.method ?? 'GET',
			headers,
			body: options.body
		});
	}

	const res = await fetch(`${GATEWAY_URL}${path}`, {
		method: options.method ?? 'GET',
		headers,
		body: options.body
	});
	return { status: res.status, body: await res.text() };
}

function toSession(s: ServerSession): ChatSession {
	let messages: ChatMessage[] = [];
	try {
		messages = JSON.parse(s.messages);
	} catch {}
	return {
		id: s.id,
		title: s.title,
		messages,
		createdAt: s.created_at,
		updatedAt: s.updated_at,
		type: (s.type as ChatSession['type']) || 'chat',
		workspacePath: s.workspace_path || '',
		model: ''
	};
}

export async function createSession(options?: { type?: 'chat' | 'cowork'; workspacePath?: string }): Promise<ChatSession> {
	const resp = await apiFetch('/api/sessions', {
		method: 'POST',
		body: JSON.stringify({
			type: options?.type || 'chat',
			workspace_path: options?.workspacePath || ''
		})
	});
	if (resp.status !== 201) throw new Error('创建会话失败');
	return toSession(JSON.parse(resp.body));
}

export async function getSession(id: string): Promise<ChatSession | undefined> {
	const resp = await apiFetch(`/api/sessions/${id}`);
	if (resp.status === 404) return undefined;
	if (resp.status !== 200) return undefined;
	return toSession(JSON.parse(resp.body));
}

export async function updateSession(id: string, data: Partial<ChatSession>): Promise<void> {
	const body: Record<string, string> = {};
	if (data.title !== undefined) body.title = data.title;
	if (data.messages !== undefined) body.messages = JSON.stringify(data.messages);
	await apiFetch(`/api/sessions/${id}`, {
		method: 'PUT',
		body: JSON.stringify(body)
	});
}

export async function deleteSession(id: string): Promise<void> {
	await apiFetch(`/api/sessions/${id}`, { method: 'DELETE' });
}

export async function listSessions(): Promise<ChatSession[]> {
	const resp = await apiFetch('/api/sessions');
	if (resp.status !== 200) return [];
	const summaries: SessionSummary[] = JSON.parse(resp.body) ?? [];
	return summaries.map((s) => ({
		id: s.id,
		title: s.title,
		messages: [],
		createdAt: s.created_at,
		updatedAt: s.updated_at,
		type: (s.type as ChatSession['type']) || 'chat',
		workspacePath: s.workspace_path || '',
		model: ''
	}));
}

export function generateTitle(firstAssistantMsg: string): string {
	const clean = firstAssistantMsg.replace(/\n/g, ' ').trim();
	if (clean.length <= 20) return clean || '新对话';
	return clean.slice(0, 20) + '…';
}
