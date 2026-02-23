import type { ChatSession } from '../sessions';

export type AppTab = 'chat' | 'cowork';

let _activeTab = $state<AppTab>('chat');
let _sidebarOpen = $state(false);
let _currentSessionId = $state<string | null>(null);
let _sessions = $state<ChatSession[]>([]);
let _isStreaming = $state(false);
let _currentAbortController = $state<(() => void) | null>(null);

export function getActiveTab(): AppTab {
	return _activeTab;
}

export function setActiveTab(tab: AppTab) {
	_activeTab = tab;
}

export function getSidebarOpen(): boolean {
	return _sidebarOpen;
}

export function setSidebarOpen(open: boolean) {
	_sidebarOpen = open;
}

export function toggleSidebar() {
	_sidebarOpen = !_sidebarOpen;
}

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
