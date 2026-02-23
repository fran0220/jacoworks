import { GATEWAY_URL } from './config';

interface User {
	id: number;
	username: string;
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

// Restore persisted session on module load
try {
	const savedToken = localStorage.getItem(TOKEN_KEY);
	const savedUser = localStorage.getItem(USER_KEY);
	if (savedToken && savedUser) {
		token = savedToken;
		user = JSON.parse(savedUser);
	}
} catch {}

export async function login(username: string, password: string): Promise<void> {
	const body = JSON.stringify({ username, password });
	let resp: HttpResponse;

	if (isTauri()) {
		const { invoke } = await import('@tauri-apps/api/core');
		resp = await invoke('http_fetch', {
			url: `${GATEWAY_URL}/api/auth/login`,
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body
		});
	} else {
		const res = await fetch(`${GATEWAY_URL}/api/auth/login`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body
		});
		resp = {
			status: res.status,
			headers: {},
			body: await res.text()
		};
	}

	if (resp.status !== 200) {
		let msg = '登录失败';
		try {
			const data = JSON.parse(resp.body);
			msg = data.error || msg;
		} catch {}
		throw new Error(msg);
	}

	const data = JSON.parse(resp.body);
	token = data.token;
	user = data.user;

	try {
		localStorage.setItem(TOKEN_KEY, token!);
		localStorage.setItem(USER_KEY, JSON.stringify(user));
	} catch {}
}

export function logout(): void {
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
