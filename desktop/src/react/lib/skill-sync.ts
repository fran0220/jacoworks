/**
 * Skills sync client — one-way push from desktop to gateway.
 * Gateway later pushes to OpenClaw containers.
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
 * Sync skills to gateway. One-way push.
 * Compares local aggregate checksum with server; uploads only if changed.
 */
export async function syncSkills(): Promise<void> {
  try {
    const token = getToken();
    if (!token) return;

    // Get server checksums
    const checksumRes = await httpFetch(`${GATEWAY_URL}/api/skills/checksum`, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });

    const serverChecksums: ChecksumResponse =
      checksumRes.status === 200
        ? JSON.parse(checksumRes.body)
        : { system: "", user: "" };

    // Builtin skills: shared/skills/ resolved relative to agent workspace
    // The agent dir is resolved by sidecar; we use a known relative path
    const builtinDir = await resolveBuiltinSkillsDir();
    if (builtinDir) {
      const builtinFiles: FileEntry[] = await invoke("list_skill_files", {
        dir: builtinDir,
      });
      if (builtinFiles.length > 0) {
        const localChecksum = await aggregateChecksum(builtinFiles);
        if (localChecksum !== serverChecksums.system) {
          await uploadSkills(token, "builtin", builtinFiles);
          console.log(
            `[skill-sync] uploaded ${builtinFiles.length} builtin skill files`,
          );
        }
      }
    }

    // User skills: <app_data>/skills (managed by sidecar.rs)
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

async function resolveBuiltinSkillsDir(): Promise<string | null> {
  try {
    // shared/skills/ is sibling to vm-agent in the repo.
    // resolve_file_path can find it relative to agent workspace.
    const resolved: string = await invoke("resolve_file_path", {
      path: "../shared/skills",
    });
    return resolved;
  } catch {
    return null;
  }
}
