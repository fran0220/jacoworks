import type { FileArtifact, FileCategory } from "../types";

const CATEGORY_LABELS: Record<FileCategory, string> = {
  image: "图片",
  pdf: "PDF",
  docx: "DOCX",
  xlsx: "XLSX",
  code: "代码",
  text: "文本",
  csv: "CSV",
  audio: "音频",
  video: "视频",
  archive: "压缩包",
  markdown: "Markdown",
  design: "设计文件",
  binary: "二进制",
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function asTimestamp(value: unknown): number | undefined {
  const numeric = asNumber(value);
  if (numeric !== null) {
    return numeric > 10_000_000_000 ? Math.round(numeric) : Math.round(numeric * 1000);
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return undefined;
}

function inferCategory(name: string, ext: string, mime: string): FileCategory {
  const normalizedExt = ext.replace(/^\./, "").toLowerCase();
  const normalizedMime = mime.toLowerCase();
  const normalizedName = name.toLowerCase();

  if (["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"].includes(normalizedExt) || normalizedMime.startsWith("image/")) {
    return "image";
  }
  if (normalizedExt === "pdf" || normalizedMime === "application/pdf") return "pdf";
  if (["docx", "doc"].includes(normalizedExt)) return "docx";
  if (["xlsx", "xls"].includes(normalizedExt)) return "xlsx";
  if (normalizedExt === "csv" || normalizedMime.includes("csv")) return "csv";
  if (normalizedExt === "md" || normalizedExt === "markdown") return "markdown";
  if (["mp4", "mov", "m4v", "webm"].includes(normalizedExt) || normalizedMime.startsWith("video/")) return "video";
  if (["mp3", "wav", "m4a", "aac", "ogg", "flac"].includes(normalizedExt) || normalizedMime.startsWith("audio/")) {
    return "audio";
  }
  if (["zip", "tar", "gz", "tgz", "rar", "7z"].includes(normalizedExt) || normalizedName.endsWith(".tar.gz")) {
    return "archive";
  }
  if (["fig", "sketch", "psd"].includes(normalizedExt)) return "design";
  if (["ts", "tsx", "js", "jsx", "py", "go", "rs", "json", "yml", "yaml", "toml", "sql", "sh", "css", "html", "xml", "log", "mjs"].includes(normalizedExt)) {
    return "code";
  }
  if (["txt", "text"].includes(normalizedExt) || normalizedMime.startsWith("text/")) return "text";
  return "binary";
}

function inferExt(name: string, path: string): string {
  const source = (name || path || "").toLowerCase();
  if (source.endsWith(".tar.gz")) return ".tar.gz";
  const match = /\.([a-z0-9]+)$/.exec(source);
  return match ? `.${match[1]}` : "";
}

function looksLikeArtifact(record: Record<string, unknown>): boolean {
  return (
    typeof record.id === "string" ||
    typeof record.artifactId === "string" ||
    typeof record.name === "string" ||
    typeof record.filename === "string" ||
    typeof record.path === "string" ||
    typeof record.pathLabel === "string"
  );
}

export function normalizeFileArtifact(value: unknown): FileArtifact | null {
  const record = asRecord(value);
  if (!looksLikeArtifact(record)) return null;

  const id = asString(record.id || record.artifactId);
  if (!id) return null;

  const path = asString(record.path || record.filePath);
  const pathLabel = asString(record.pathLabel || path) || undefined;
  const name = asString(record.name || record.filename) || pathLabel || id;
  const ext = asString(record.ext) || inferExt(name, path);
  const mime = asString(record.mime || record.mimeType);
  const categoryInput = asString(record.category).toLowerCase() as FileCategory;
  const category = categoryInput || inferCategory(name, ext, mime);
  const baseContentUrl = `/api/files/${encodeURIComponent(id)}/content`;
  const contentUrl = asString(record.contentUrl) || baseContentUrl;
  const downloadUrl = asString(record.downloadUrl) || `${baseContentUrl}?download=1`;
  const size = asNumber(record.size);
  const containerName = asString(record.containerName);
  const thumbnailUrl = asString(record.thumbnailUrl) || (category === "image" ? contentUrl : "");

  return {
    id,
    name,
    pathLabel,
    ext: ext || undefined,
    mime: mime || undefined,
    size,
    category,
    contentUrl,
    downloadUrl,
    createdAt: asTimestamp(record.createdAt),
    artifactId: id,
    filename: name,
    path: path || undefined,
    mimeType: mime || undefined,
    containerName: containerName || undefined,
    thumbnailUrl: thumbnailUrl || undefined,
  };
}

export function extractFileArtifact(value: unknown): FileArtifact | null {
  const direct = normalizeFileArtifact(value);
  if (direct) return direct;

  const record = asRecord(value);
  return (
    normalizeFileArtifact(record.fileArtifact) ||
    normalizeFileArtifact(record.file_artifact) ||
    normalizeFileArtifact(record.artifact) ||
    null
  );
}

export function getFileTypeLabel(artifact: Pick<FileArtifact, "category" | "ext" | "mime">): string {
  if (artifact.ext) return artifact.ext.replace(/^\./, "").toUpperCase();
  if (artifact.category) return CATEGORY_LABELS[artifact.category] || artifact.category;
  if (artifact.mime) return artifact.mime;
  return "文件";
}
