import { mkdir, readFile, appendFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";

/** Hard limit for MEMORY.md — forces agent to consolidate rather than accumulate */
export const MEMORY_MAX_CHARS = 3000;

function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function getDailyLogPath(memoryRootDir: string, date?: Date): string {
  return join(memoryRootDir, "daily", `${formatDate(date ?? new Date())}.md`);
}

export async function appendDailyLog(
  memoryRootDir: string,
  content: string,
): Promise<void> {
  const logPath = getDailyLogPath(memoryRootDir);
  await mkdir(dirname(logPath), { recursive: true });
  await appendFile(logPath, content, "utf-8");
}

export async function readDailyLog(
  memoryRootDir: string,
  date: Date,
  maxLines = 30,
): Promise<string> {
  const logPath = getDailyLogPath(memoryRootDir, date);
  try {
    const text = await readFile(logPath, "utf-8");
    const lines = text.split("\n");
    if (lines.length <= maxLines) return text;
    return lines.slice(-maxLines).join("\n");
  } catch {
    return "";
  }
}

export async function readMemoryMd(
  memoryRootDir: string,
  maxChars = 2000,
): Promise<string> {
  const memPath = join(memoryRootDir, "MEMORY.md");
  try {
    const text = await readFile(memPath, "utf-8");
    if (text.length <= maxChars) return text;
    return text.slice(0, maxChars) + "\n...(truncated)";
  } catch {
    return "";
  }
}

/** Read full MEMORY.md without truncation (for replace/remove operations) */
export async function readFullMemoryMd(memoryRootDir: string): Promise<string> {
  const memPath = join(memoryRootDir, "MEMORY.md");
  try {
    return await readFile(memPath, "utf-8");
  } catch {
    return "";
  }
}

/** Overwrite MEMORY.md with exact content */
export async function writeMemoryMd(
  memoryRootDir: string,
  content: string,
): Promise<void> {
  const memPath = join(memoryRootDir, "MEMORY.md");
  await mkdir(dirname(memPath), { recursive: true });
  await writeFile(memPath, content, "utf-8");
}

/**
 * Trim MEMORY.md to fit within MEMORY_MAX_CHARS by removing oldest entries.
 * Entries are separated by `\n## ` headings; plain paragraphs at the top
 * are treated as one block.
 */
export function trimMemoryToLimit(text: string, limit = MEMORY_MAX_CHARS): string {
  if (text.length <= limit) return text;

  // Split into sections by ## headings (keeping heading with body)
  const sections: string[] = [];
  const lines = text.split("\n");
  let current = "";

  for (const line of lines) {
    if (line.startsWith("## ") && current.trim()) {
      sections.push(current);
      current = line + "\n";
    } else {
      current += line + "\n";
    }
  }
  if (current.trim()) sections.push(current);

  // Drop oldest sections (from the front) until under limit
  while (sections.length > 1) {
    const total = sections.join("").length;
    if (total <= limit) break;
    sections.shift();
  }

  let result = sections.join("").trim();

  // If still over limit (single giant section), hard truncate from the front
  if (result.length > limit) {
    result = result.slice(result.length - limit);
    const firstNewline = result.indexOf("\n");
    if (firstNewline > 0 && firstNewline < 200) {
      result = result.slice(firstNewline + 1);
    }
  }

  return result;
}

export async function appendMemoryMd(
  memoryRootDir: string,
  content: string,
  section?: string,
): Promise<void> {
  const memPath = join(memoryRootDir, "MEMORY.md");
  let existing = "";
  try {
    existing = await readFile(memPath, "utf-8");
  } catch {
    // file doesn't exist yet
  }

  const entry = section
    ? `\n## ${section}\n\n${content}\n`
    : `\n${content}\n`;

  const combined = trimMemoryToLimit(existing + entry);

  await mkdir(dirname(memPath), { recursive: true });
  await writeFile(memPath, combined, "utf-8");
}
