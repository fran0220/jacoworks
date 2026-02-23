import { GATEWAY_URL } from './config';
import { getToken } from './auth.svelte';

function isTauri(): boolean {
	return typeof window !== 'undefined' && '__TAURI__' in window;
}

export async function selectFolder(): Promise<string | null> {
	if (!isTauri()) return null;
	const { invoke } = await import('@tauri-apps/api/core');
	return invoke('select_directory');
}

export async function uploadFolder(sessionId: string, folderPath: string): Promise<{ uploaded: number; total_size: number }> {
	if (!isTauri()) throw new Error('仅支持桌面端');
	const { invoke } = await import('@tauri-apps/api/core');
	const token = getToken();
	return invoke('upload_cowork', {
		sessionId,
		folderPath,
		gatewayUrl: GATEWAY_URL,
		token
	});
}

export async function pullChanges(sessionId: string, localFolder: string): Promise<number> {
	if (!isTauri()) return 0;
	const { invoke } = await import('@tauri-apps/api/core');
	const token = getToken();
	return invoke('download_cowork', {
		sessionId,
		localFolder,
		gatewayUrl: GATEWAY_URL,
		token
	});
}

export function folderName(path: string): string {
	const parts = path.replace(/\\/g, '/').split('/').filter(Boolean);
	return parts[parts.length - 1] || path;
}
