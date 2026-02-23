import { GATEWAY_URL } from './config';

interface User {
	id: string;
	name: string;
	email: string;
	role: string;
}

interface HttpResponse {
	status: number;
	headers: Record<string, string>;
	body: string;
}

const TOKEN_KEY = 'jacoworks_token';
const USER_KEY = 'jacoworks_user';

let token = $state<string | null>(null);
let user = $state<User | null>(null);

function isTauri(): boolean {
	return typeof window !== 'undefined' && '__TAURI__' in window;
}

async function authFetch(
	path: string,
	options: { method?: string; headers?: Record<string, string>; body?: string } = {}
): Promise<HttpResponse> {
	const url = `${GATEWAY_URL}${path}`;
	const method = options.method ?? 'POST';
	const headers: Record<string, string> = { 'Content-Type': 'application/json', ...options.headers };

	if (token) {
		headers['Authorization'] = `Bearer ${token}`;
	}

	if (isTauri()) {
		const { invoke } = await import('@tauri-apps/api/core');
		return invoke('http_fetch', { url, method, headers, body: options.body });
	}

	const res = await fetch(url, { method, headers, body: options.body });
	const respHeaders: Record<string, string> = {};
	res.headers.forEach((v, k) => {
		respHeaders[k] = v;
	});
	return { status: res.status, headers: respHeaders, body: await res.text() };
}

// Restore persisted session on module load
try {
	const savedToken = localStorage.getItem(TOKEN_KEY);
	const savedUser = localStorage.getItem(USER_KEY);
	if (savedToken && savedUser) {
		token = savedToken;
		user = JSON.parse(savedUser);
	}
} catch {}

function saveSession(newToken: string, newUser: User): void {
	token = newToken;
	user = newUser;
	try {
		localStorage.setItem(TOKEN_KEY, newToken);
		localStorage.setItem(USER_KEY, JSON.stringify(newUser));
	} catch {}
}

// Login with email/password
export async function login(email: string, password: string): Promise<void> {
	const resp = await authFetch('/api/auth/login', {
		body: JSON.stringify({ email, password }),
	});

	if (resp.status !== 200) {
		let msg = '登录失败';
		try {
			const data = JSON.parse(resp.body);
			msg = data.error || msg;
		} catch {}
		throw new Error(msg);
	}

	const data = JSON.parse(resp.body);
	if (!data.token) throw new Error('未获取到 token');

	saveSession(data.token, data.user);
}

// Login with Feishu SSO
export async function loginWithFeishu(): Promise<void> {
	const frontendUrl =
		typeof window !== 'undefined' ? window.location.origin : 'http://localhost:1420';

	window.location.href = `${GATEWAY_URL}/api/auth/feishu?redirect=${encodeURIComponent(frontendUrl)}`;
}

// Handle OAuth callback token from URL (called on page load)
export async function handleOAuthCallback(): Promise<boolean> {
	if (typeof window === 'undefined') return false;

	const params = new URLSearchParams(window.location.search);
	const callbackToken = params.get('token');
	const callbackError = params.get('error');

	if (callbackError) {
		window.history.replaceState({}, '', window.location.pathname);
		throw new Error(`登录失败: ${callbackError}`);
	}

	if (!callbackToken) return false;

	// Clean URL immediately
	window.history.replaceState({}, '', window.location.pathname);

	// Use the token to fetch user info
	token = callbackToken;
	const resp = await authFetch('/api/users/me', { method: 'GET' });

	if (resp.status === 200) {
		const data = JSON.parse(resp.body);
		saveSession(callbackToken, {
			id: data.id || '',
			name: data.name || '',
			email: data.email || '',
			role: data.role || 'user',
		});
		return true;
	}

	// Token invalid, clear
	token = null;
	throw new Error('Session 验证失败');
}

// Activate with invitation code
export async function activateWithCode(
	code: string,
	username: string,
	password: string
): Promise<void> {
	const resp = await authFetch('/api/auth/activate', {
		body: JSON.stringify({ code, username, password }),
	});

	if (resp.status !== 200) {
		let msg = '激活失败';
		try {
			const data = JSON.parse(resp.body);
			msg = data.error || msg;
		} catch {}
		throw new Error(msg);
	}

	const data = JSON.parse(resp.body);
	if (!data.token) throw new Error('未获取到 token');

	saveSession(data.token, data.user);
}

export function logout(): void {
	if (token) {
		authFetch('/api/auth/logout', {
			headers: { Authorization: `Bearer ${token}` },
		}).catch(() => {});
	}

	token = null;
	user = null;
	try {
		localStorage.removeItem(TOKEN_KEY);
		localStorage.removeItem(USER_KEY);
	} catch {}
}

export function getToken(): string | null {
	return token;
}

export function isAuthenticated(): boolean {
	return token !== null;
}

export function getUser(): User | null {
	return user;
}
