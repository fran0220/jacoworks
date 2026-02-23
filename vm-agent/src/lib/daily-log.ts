import { mkdir, readFile, appendFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";

function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function getDailyLogPath(workspaceDir: string, date?: Date): string {
  return join(workspaceDir, "memory", `${formatDate(date ?? new Date())}.md`);
}

export async function appendDailyLog(
  workspaceDir: string,
  content: string,
): Promise<void> {
  const logPath = getDailyLogPath(workspaceDir);
  await mkdir(dirname(logPath), { recursive: true });
  await appendFile(logPath, content, "utf-8");
}

export async function readDailyLog(
  workspaceDir: string,
  date: Date,
  maxLines = 30,
): Promise<string> {
  const logPath = getDailyLogPath(workspaceDir, date);
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
  workspaceDir: string,
  maxChars = 2000,
): Promise<string> {
  const memPath = join(workspaceDir, "MEMORY.md");
  try {
    const text = await readFile(memPath, "utf-8");
    if (text.length <= maxChars) return text;
    return text.slice(0, maxChars) + "\n...(truncated)";
  } catch {
    return "";
  }
}

export async function appendMemoryMd(
  workspaceDir: string,
  content: string,
  section?: string,
): Promise<void> {
  const memPath = join(workspaceDir, "MEMORY.md");
  let existing = "";
  try {
    existing = await readFile(memPath, "utf-8");
  } catch {
    // file doesn't exist yet
  }

  const entry = section
    ? `\n## ${section}\n\n${content}\n`
    : `\n${content}\n`;

  await mkdir(dirname(memPath), { recursive: true });
  await writeFile(memPath, existing + entry, "utf-8");
}
