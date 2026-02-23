import { createStore, get, set, del, keys } from 'idb-keyval';

export interface ChatMessage {
	role: 'system' | 'user' | 'assistant';
	content: string;
}

export interface ChatSession {
	id: string;
	title: string;
	messages: ChatMessage[];
	createdAt: number;
	updatedAt: number;
}

const store = createStore('jacoworks-sessions', 'sessions');

export async function createSession(): Promise<ChatSession> {
	const session: ChatSession = {
		id: crypto.randomUUID(),
		title: '新对话',
		messages: [],
		createdAt: Date.now(),
		updatedAt: Date.now()
	};
	await set(session.id, session, store);
	return session;
}

export async function getSession(id: string): Promise<ChatSession | undefined> {
	return get<ChatSession>(id, store);
}

export async function updateSession(id: string, data: Partial<ChatSession>): Promise<void> {
	const existing = await get<ChatSession>(id, store);
	if (!existing) return;
	const updated = { ...existing, ...data, updatedAt: Date.now() };
	await set(id, updated, store);
}

export async function deleteSession(id: string): Promise<void> {
	await del(id, store);
}

export async function listSessions(): Promise<ChatSession[]> {
	const allKeys = await keys(store);
	const sessions: ChatSession[] = [];
	for (const key of allKeys) {
		const session = await get<ChatSession>(key, store);
		if (session) sessions.push(session);
	}
	return sessions.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function generateTitle(firstAssistantMsg: string): string {
	const clean = firstAssistantMsg.replace(/\n/g, ' ').trim();
	if (clean.length <= 20) return clean || '新对话';
	return clean.slice(0, 20) + '…';
}
