import { GATEWAY_URL, AUTH_TOKEN } from "./config";
import type { FileArtifact } from "../types";
import { normalizeFileArtifact } from "./file-artifacts";

const MAX_UPLOAD_SIZE = 50 * 1024 * 1024; // 50MB

export interface UploadResult {
  vmPath: string;
  artifact?: FileArtifact;
}

export function validateFileSize(file: File): string | null {
  if (file.size > MAX_UPLOAD_SIZE) {
    return `文件 "${file.name}" 超过 50MB 限制`;
  }
  return null;
}

export async function uploadFile(file: File): Promise<UploadResult> {
  const form = new FormData();
  form.append("file", file);

  const res = await fetch(`${GATEWAY_URL}/api/files/upload`, {
    method: "POST",
    headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
    body: form,
  });

  if (res.status === 401) {
    throw new Error("登录已过期");
  }
  if (res.status === 413) {
    throw new Error("文件超过 50MB 限制");
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: `上传失败 (${res.status})` }));
    throw new Error(body.error || `上传失败 (${res.status})`);
  }

  const data = (await res.json()) as { vmPath?: string; artifact?: unknown };
  const vmPath = data.vmPath;
  if (!vmPath) throw new Error("上传响应缺少 vmPath");

  return {
    vmPath,
    artifact: normalizeFileArtifact(data.artifact) ?? undefined,
  };
}

export function buildMessageWithAttachments(text: string, uploads: { name: string; vmPath: string }[]): string {
  const ready = uploads.filter((u) => u.vmPath);
  if (ready.length === 0) return text.trim();

  const lines = ready.map((u) => `- ${u.name}: ${u.vmPath}`);
  const suffix = ["[已上传附件]", ...lines].join("\n");

  return [text.trim(), suffix].filter(Boolean).join("\n\n");
}
