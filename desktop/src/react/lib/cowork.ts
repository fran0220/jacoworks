import { invoke, isTauri } from "@tauri-apps/api/core";

export async function selectFolder(): Promise<string | null> {
  if (!isTauri()) return null;
  return invoke("select_directory");
}

export function folderName(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts[parts.length - 1] || path;
}

/** Check if a workspace path is the auto-generated default sync dir (syncRoot/sessionId). */
export function isDefaultSyncDir(path: string, syncRoot: string): boolean {
  if (!path || !syncRoot) return false;
  const norm = path.replace(/\\/g, "/").replace(/\/+$/, "");
  const root = syncRoot.replace(/\\/g, "/").replace(/\/+$/, "");
  if (!norm.startsWith(root + "/")) return false;
  // The remainder after syncRoot/ should be a single UUID-like segment
  const remainder = norm.slice(root.length + 1);
  return /^[0-9a-f-]+$/i.test(remainder) && !remainder.includes("/");
}
