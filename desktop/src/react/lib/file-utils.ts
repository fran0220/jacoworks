import { invoke, isTauri } from "@tauri-apps/api/core";

export interface ImportedFile {
  name: string;
  /** Relative path from workspace root, e.g. "_attachments/report.pdf" */
  path: string;
  size: number;
}
export async function importFilesNative(
  workspace: string,
): Promise<{ imported: ImportedFile[]; warnings: string[] }> {
  if (!workspace) {
    return { imported: [], warnings: ["请先选择工作目录"] };
  }

  if (!isTauri()) {
    return { imported: [], warnings: ["文件导入仅在桌面端可用"] };
  }

  try {
    const result = await invoke<{
      imported: { name: string; path: string; size: number }[];
      warnings: string[];
    }>("import_files_native", {
      workspace,
    });

    return result;
  } catch (err) {
    return { imported: [], warnings: [`文件导入失败: ${err}`] };
  }
}

export async function importFilesByPaths(
  paths: string[],
  workspace: string,
): Promise<{ imported: ImportedFile[]; warnings: string[] }> {
  if (!paths.length || !workspace) {
    return { imported: [], warnings: [] };
  }

  if (!isTauri()) {
    return { imported: [], warnings: ["文件导入仅在桌面端可用"] };
  }

  try {
    return await invoke<{
      imported: { name: string; path: string; size: number }[];
      warnings: string[];
    }>("import_files_by_paths", {
      paths,
      workspace,
    });
  } catch (err) {
    return { imported: [], warnings: [`文件导入失败: ${err}`] };
  }
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
