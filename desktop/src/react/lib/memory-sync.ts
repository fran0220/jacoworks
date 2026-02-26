/**
 * Memory sync client — bidirectional sync with gateway.
 * Called silently before/after agent sessions.
 */

import { invoke } from "@tauri-apps/api/core";
import { getToken } from "./auth";
import { GATEWAY_URL } from "./config";
import { httpFetch } from "./transport";

async function contentChecksum(content: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const hash = await crypto.subtle.digest("SHA-256", data);
  const bytes = new Uint8Array(hash);
  return Array.from(bytes.slice(0, 8))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

interface FileEntry {
  path: string;
  content: string;
}

interface ManifestEntry {
  path: string;
  checksum: string;
}

interface PullEntry {
  path: string;
  content: string;
  checksum: string;
}

interface SyncResponse {
  pull: PullEntry[] | null;
  push_accepted: string[] | null;
  server_time: string;
}

/**
 * Sync memory with gateway. Call before/after agent sessions.
 * Returns number of files synced (pulled + pushed).
 */
export async function syncMemory(): Promise<number> {
  try {
    const token = getToken();
    if (!token) return 0;

    const localFiles: FileEntry[] = await invoke("list_memory_files");

    const manifest: ManifestEntry[] = [];
    const push: FileEntry[] = [];

    for (const file of localFiles) {
      const checksum = await contentChecksum(file.content);
      manifest.push({ path: file.path, checksum });
      push.push({ path: file.path, content: file.content });
    }

    const res = await httpFetch(`${GATEWAY_URL}/api/memory/sync`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ manifest, push }),
    });

    if (res.status !== 200) {
      console.warn("[memory-sync] sync failed:", res.status);
      return 0;
    }

    const data: SyncResponse = JSON.parse(res.body);

    if (data.pull && data.pull.length > 0) {
      const files = data.pull.map(({ path, content }) => ({ path, content }));
      await invoke("write_memory_files", { files });
    }

    const pullCount = data.pull?.length ?? 0;
    const pushCount = data.push_accepted?.length ?? 0;

    if (pullCount > 0 || pushCount > 0) {
      console.log(`[memory-sync] pulled ${pullCount}, pushed ${pushCount}`);
    }

    return pullCount + pushCount;
  } catch (err) {
    console.warn("[memory-sync] sync error:", err);
    return 0;
  }
}
