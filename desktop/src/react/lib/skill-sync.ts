/**
 * Skills sync client:
 *   pull: gateway → desktop (system skills, source of truth)
 *   push: desktop → gateway (user skills only, for OpenClaw containers)
 *   poll: periodic checksum check for silent updates
 *
 * System skills are managed exclusively on the gateway (admin hotfix).
 * Desktop only pulls system skills and caches them in app_data/remote-skills/.
 * User-created skills are pushed to gateway for OpenClaw container access.
 */

import { invoke } from "@tauri-apps/api/core";
import { getToken } from "./auth";
import { GATEWAY_URL } from "./config";
import { httpFetch } from "./transport";

interface FileEntry {
  path: string;
  content: string;
}

interface ChecksumResponse {
  system: string;
  user: string;
}

async function contentChecksum(content: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const hash = await crypto.subtle.digest("SHA-256", data);
  const bytes = new Uint8Array(hash);
  return Array.from(bytes.slice(0, 8))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function aggregateChecksum(files: FileEntry[]): Promise<string> {
  const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path));
  const checksums = await Promise.all(
    sorted.map((f) => contentChecksum(f.content)),
  );
  return contentChecksum(checksums.join(","));
}

async function uploadSkills(
  token: string,
  source: "builtin" | "user",
  files: FileEntry[],
): Promise<void> {
  const res = await httpFetch(`${GATEWAY_URL}/api/skills/upload`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ source, files }),
  });

  if (res.status !== 200) {
    throw new Error(`Skills upload failed: ${res.status}`);
  }
}

/**
 * Push user-created skills to gateway (for OpenClaw container access).
 * Only uploads user skills; system skills are managed on the gateway.
 */
export async function syncUserSkills(): Promise<void> {
  try {
    const token = getToken();
    if (!token) return;

    const checksumRes = await httpFetch(`${GATEWAY_URL}/api/skills/checksum`, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });

    const serverChecksums: ChecksumResponse =
      checksumRes.status === 200
        ? JSON.parse(checksumRes.body)
        : { system: "", user: "" };

    const userDir: string = await invoke("get_user_skills_dir");
    const userFiles: FileEntry[] = await invoke("list_skill_files", {
      dir: userDir,
    });
    if (userFiles.length > 0) {
      const localChecksum = await aggregateChecksum(userFiles);
      if (localChecksum !== serverChecksums.user) {
        await uploadSkills(token, "user", userFiles);
        console.log(
          `[skill-sync] uploaded ${userFiles.length} user skill files`,
        );
      }
    }
  } catch (err) {
    console.warn("[skill-sync] sync error:", err);
  }
}

// ─── Pull: gateway → desktop (system skills, source of truth) ──

/** Cached ETag from last pull, avoids re-downloading unchanged skills. */
let lastPullEtag = "";

interface PullSkillFile {
  file_path: string;
  content: string;
  checksum: string;
}

interface PullResponse {
  files: PullSkillFile[];
  checksum: string;
}

/**
 * Pull system skills from gateway and write to app_data/remote-skills/.
 * Uses ETag to skip download when server skills haven't changed.
 * Should be called BEFORE starting the agent sidecar.
 */
export async function pullSystemSkills(): Promise<void> {
  try {
    const token = getToken();
    if (!token) return;

    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
    };
    if (lastPullEtag) {
      headers["If-None-Match"] = lastPullEtag;
    }

    const res = await httpFetch(`${GATEWAY_URL}/api/skills/pull`, {
      method: "GET",
      headers,
    });

    if (res.status === 304) {
      return;
    }

    if (res.status !== 200) {
      console.warn("[skill-pull] server returned", res.status);
      return;
    }

    const data: PullResponse = JSON.parse(res.body);
    if (!data.files || data.files.length === 0) {
      return;
    }

    await invoke("write_remote_skills", {
      files: data.files.map((f) => ({
        file_path: f.file_path,
        content: f.content,
      })),
    });

    lastPullEtag = data.checksum || "";
    console.log(
      `[skill-pull] pulled ${data.files.length} system skills from gateway`,
    );
  } catch (err) {
    console.warn("[skill-pull] pull error:", err);
  }
}

// ─── Periodic polling for skill updates ──────────────────────

const POLL_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
let pollTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Start periodic skill polling. Checks gateway checksum every 30 min;
 * pulls new skills if changed. New agent sessions will pick them up lazily.
 */
export function startSkillPolling(): void {
  if (pollTimer) return;
  pollTimer = setInterval(() => {
    pullSystemSkills().catch((err) =>
      console.warn("[skill-poll] poll error:", err),
    );
  }, POLL_INTERVAL_MS);
  console.log("[skill-poll] started (interval: 30min)");
}

/** Stop periodic skill polling. */
export function stopSkillPolling(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}
