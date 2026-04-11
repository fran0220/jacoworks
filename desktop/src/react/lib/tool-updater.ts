import { invoke } from "@tauri-apps/api/core";
import type { ToolManifestEntry } from "./auth";

interface LocalManifest {
  [toolName: string]: string; // name → version
}

export async function checkAndUpdateTools(
  manifest?: ToolManifestEntry[],
): Promise<void> {
  if (!manifest || manifest.length === 0) return;

  const platformKey: string = await invoke("get_platform_key");
  const localRaw: string = await invoke("get_local_tools_manifest");
  let local: LocalManifest;
  try {
    local = JSON.parse(localRaw);
  } catch {
    local = {};
  }

  const updates: Array<{ name: string; version: string; url: string; sha256: string }> = [];

  for (const entry of manifest) {
    if (local[entry.name] === entry.version) continue;
    const platform = entry.platforms[platformKey];
    if (!platform) continue;
    updates.push({
      name: entry.name,
      version: entry.version,
      url: platform.url,
      sha256: platform.sha256,
    });
  }

  if (updates.length === 0) return;

  console.log(
    `[tool-updater] ${updates.length} tool(s) need updating: ${updates.map((u) => `${u.name}@${u.version}`).join(", ")}`,
  );

  for (const update of updates) {
    try {
      console.log(`[tool-updater] Downloading ${update.name}@${update.version}...`);
      await invoke("download_cli_tool", {
        name: update.name,
        url: update.url,
        expectedSha256: update.sha256,
      });
      local[update.name] = update.version;
      await invoke("save_local_tools_manifest", {
        manifest: JSON.stringify(local),
      });
      console.log(`[tool-updater] Updated ${update.name} to ${update.version}`);
    } catch (err) {
      console.warn(`[tool-updater] Failed to update ${update.name}:`, err);
    }
  }
}
