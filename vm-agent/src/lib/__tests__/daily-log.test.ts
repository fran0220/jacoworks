/**
 * daily-log.ts 单元测试
 *
 * 覆盖: getDailyLogPath、appendDailyLog、readDailyLog、
 *       readMemoryMd、appendMemoryMd
 *
 * 运行: bun test src/lib/__tests__/daily-log.test.ts
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getDailyLogPath,
  appendDailyLog,
  readDailyLog,
  readMemoryMd,
  appendMemoryMd,
} from "../daily-log.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "dailylog-test-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ─── getDailyLogPath ────────────────────────────────

describe("getDailyLogPath", () => {
  test("generates correct path for a specific date", () => {
    const date = new Date(2026, 1, 28); // Feb 28, 2026
    const path = getDailyLogPath(tmpDir, date);
    expect(path).toBe(join(tmpDir, "daily", "2026-02-28.md"));
  });

  test("uses current date when no date provided", () => {
    const path = getDailyLogPath(tmpDir);
    // Should contain today's date
    const today = new Date();
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, "0");
    const d = String(today.getDate()).padStart(2, "0");
    expect(path).toBe(join(tmpDir, "daily", `${y}-${m}-${d}.md`));
  });
});

// ─── appendDailyLog & readDailyLog ──────────────────

describe("appendDailyLog / readDailyLog", () => {
  test("creates directory and appends content", async () => {
    await appendDailyLog(tmpDir, "## 10:30\nFirst entry\n\n");
    await appendDailyLog(tmpDir, "## 11:00\nSecond entry\n\n");

    const content = await readDailyLog(tmpDir, new Date());
    expect(content).toContain("First entry");
    expect(content).toContain("Second entry");
  });

  test("returns empty string for non-existent log", async () => {
    const pastDate = new Date(2020, 0, 1);
    const content = await readDailyLog(tmpDir, pastDate);
    expect(content).toBe("");
  });

  test("truncates to maxLines from end", async () => {
    const lines = Array.from({ length: 50 }, (_, i) => `Line ${i}`).join("\n");
    await appendDailyLog(tmpDir, lines);

    const content = await readDailyLog(tmpDir, new Date(), 5);
    const resultLines = content.split("\n");
    expect(resultLines.length).toBe(5);
    expect(content).toContain("Line 49");
  });
});

// ─── readMemoryMd & appendMemoryMd ──────────────────

describe("readMemoryMd / appendMemoryMd", () => {
  test("returns empty for non-existent MEMORY.md", async () => {
    const content = await readMemoryMd(tmpDir);
    expect(content).toBe("");
  });

  test("appends content without section", async () => {
    await appendMemoryMd(tmpDir, "Some important fact.");
    const content = await readMemoryMd(tmpDir);
    expect(content).toContain("Some important fact.");
  });

  test("appends content under a section heading", async () => {
    await appendMemoryMd(tmpDir, "User prefers dark mode.", "Preferences");
    const content = await readMemoryMd(tmpDir);
    expect(content).toContain("## Preferences");
    expect(content).toContain("User prefers dark mode.");
  });

  test("accumulates multiple appends", async () => {
    await appendMemoryMd(tmpDir, "Fact one.");
    await appendMemoryMd(tmpDir, "Fact two.", "Section B");
    const content = await readMemoryMd(tmpDir, 10000);
    expect(content).toContain("Fact one.");
    expect(content).toContain("Fact two.");
    expect(content).toContain("## Section B");
  });

  test("truncates when exceeding maxChars", async () => {
    const longContent = "A".repeat(5000);
    await appendMemoryMd(tmpDir, longContent);
    const content = await readMemoryMd(tmpDir, 100);
    expect(content.length).toBeLessThan(200);
    expect(content).toContain("...(truncated)");
  });
});
