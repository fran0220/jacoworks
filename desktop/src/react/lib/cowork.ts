import { invoke, isTauri } from "@tauri-apps/api/core";

export async function selectFolder(): Promise<string | null> {
  if (!isTauri()) return null;
  return invoke("select_directory");
}

export function folderName(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts[parts.length - 1] || path;
}
