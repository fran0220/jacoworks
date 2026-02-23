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
	created_at: string | number;
	updated_at: string | number;
	type?: string;
	workspace_path?: string;
}

interface ServerSession {
	id: string;
	user_id: string;
	title: string;
	messages: string | any[];
	created_at: string | number;
	updated_at: string | number;
	type?: string;
	workspace_path?: string;
	model?: string;
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

function parseTime(v: string | number | undefined): number {
	if (typeof v === 'number') return v;
	if (typeof v === 'string') return new Date(v).getTime();
	return Date.now();
}

function toSession(s: ServerSession): ChatSession {
	let messages: ChatMessage[] = [];
	try {
		if (typeof s.messages === 'string') {
			messages = JSON.parse(s.messages);
		} else if (Array.isArray(s.messages)) {
			messages = s.messages;
		}
	} catch {}
	return {
		id: s.id,
		title: s.title,
		messages,
		createdAt: parseTime(s.created_at),
		updatedAt: parseTime(s.updated_at),
		type: (s.type as ChatSession['type']) || 'chat',
		workspacePath: s.workspace_path || '',
		model: s.model || ''
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
		createdAt: parseTime(s.created_at),
		updatedAt: parseTime(s.updated_at),
		type: (s.type as ChatSession['type']) || 'chat',
		workspacePath: s.workspace_path || '',
		model: ''
	}));
}

// Cowork container APIs

export interface ContainerStatus {
	provisioned: boolean;
	container_name?: string;
	container_ip?: string;
}

export interface ProvisionResult {
	status: 'ready' | 'provisioning';
	container_name: string;
	ip?: string;
	warning?: string;
}

export async function getContainerStatus(): Promise<ContainerStatus> {
	const resp = await apiFetch('/api/cowork/container-status');
	if (resp.status !== 200) return { provisioned: false };
	return JSON.parse(resp.body);
}

export async function provisionContainer(): Promise<ProvisionResult> {
	const resp = await apiFetch('/api/cowork/provision', { method: 'POST' });
	if (resp.status >= 400) {
		const data = JSON.parse(resp.body);
		throw new Error(data.error || '容器分配失败');
	}
	return JSON.parse(resp.body);
}

export function generateTitle(firstAssistantMsg: string): string {
	const clean = firstAssistantMsg.replace(/\n/g, ' ').trim();
	if (clean.length <= 20) return clean || '新对话';
	return clean.slice(0, 20) + '…';
}
