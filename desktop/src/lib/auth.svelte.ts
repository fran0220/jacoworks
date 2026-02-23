import { GATEWAY_URL } from './config';
import { invoke } from '@tauri-apps/api/core';

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

let token = $state<string | null>(null);
let user = $state<User | null>(null);

export async function login(username: string, password: string): Promise<void> {
	const resp: HttpResponse = await invoke('http_fetch', {
		url: `${GATEWAY_URL}/api/auth/login`,
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ username, password })
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
	token = data.token;
	user = data.user;
}

export function logout(): void {
	token = null;
	user = null;
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
