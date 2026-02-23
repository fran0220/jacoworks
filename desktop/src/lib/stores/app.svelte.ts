import type { ChatSession } from '../sessions';

let _currentSessionId = $state<string | null>(null);
let _sessions = $state<ChatSession[]>([]);
let _isStreaming = $state(false);
let _currentAbortController = $state<(() => void) | null>(null);

export function getCurrentSessionId(): string | null {
	return _currentSessionId;
}

export function setCurrentSessionId(id: string | null) {
	_currentSessionId = id;
}

export function getSessions(): ChatSession[] {
	return _sessions;
}

export function setSessions(s: ChatSession[]) {
	_sessions = s;
}

export function getIsStreaming(): boolean {
	return _isStreaming;
}

export function setIsStreaming(v: boolean) {
	_isStreaming = v;
}

export function getAbortController(): (() => void) | null {
	return _currentAbortController;
}

export function setAbortController(fn: (() => void) | null) {
	_currentAbortController = fn;
}
