import { invoke, isTauri } from "@tauri-apps/api/core";

export interface ImportedFile {
  name: string;
  /** Relative path from workspace root, e.g. "_attachments/report.pdf" */
  path: string;
  size: number;
}

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      // Strip "data:...;base64," prefix
      resolve(dataUrl.split(",")[1] || "");
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/**
 * Import user-selected files into the workspace _attachments/ directory.
 * Returns imported files with workspace-relative paths.
 * The Agent uses read/read_document tools to access them — no frontend parsing needed.
 */
export async function importFiles(
  fileList: FileList,
  workspace: string,
): Promise<{ imported: ImportedFile[]; warnings: string[] }> {
  const warnings: string[] = [];

  if (!workspace) {
    warnings.push("请先选择工作目录");
    return { imported: [], warnings };
  }

  const files = Array.from(fileList);
  const rejected = files.filter((f) => f.size > MAX_FILE_SIZE);
  const accepted = files.filter((f) => f.size <= MAX_FILE_SIZE);

  for (const f of rejected) {
    warnings.push(`${f.name} 超过 10 MB 限制`);
  }

  if (accepted.length === 0) {
    return { imported: [], warnings };
  }

  if (!isTauri()) {
    warnings.push("文件导入仅在桌面端可用");
    return { imported: [], warnings };
  }

  try {
    const fileData = await Promise.all(
      accepted.map(async (f) => ({
        name: f.name,
        data: await readAsBase64(f),
      })),
    );

    const result = await invoke<{ name: string; path: string }[]>("import_files", {
      files: fileData,
      workspace,
    });

    const imported: ImportedFile[] = result.map((r, i) => ({
      ...r,
      size: accepted[i]?.size ?? 0,
    }));

    return { imported, warnings };
  } catch (err) {
    warnings.push(`文件导入失败: ${err}`);
    return { imported: [], warnings };
  }
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
