import { Type, type Static } from "@sinclair/typebox";
import type { ExtensionFactory, ToolDefinition } from "@mariozechner/pi-coding-agent";
import { spawn } from "node:child_process";
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, extname, basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chunkMarkdown, getMemoryStore, type MemoryStoreConfig } from "../lib/memory-store.js";

// ─── Parameter Schema ───────────────────────────────

const ReadDocumentParams = Type.Object({
  path: Type.String({ description: "File path (relative to workspace or absolute)" }),
  sheet: Type.Optional(
    Type.String({ description: "Sheet name or 1-based index for Excel files (default: first sheet)" }),
  ),
  max_rows: Type.Optional(
    Type.Number({ description: "Max rows to return for Excel/CSV (default: 500)" }),
  ),
});

// ─── Supported extensions ───────────────────────────

const DOC_EXTS = new Set([".docx", ".doc", ".xlsx", ".xls", ".csv", ".pdf", ".pptx", ".ppt"]);
const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".tiff", ".tif"]);
const MINERU_DOC_EXTS = new Set([".docx", ".doc", ".pdf", ".pptx", ".ppt"]);
const LARGE_CONTENT_THRESHOLD = 2000;
const SUMMARY_PREVIEW_CHARS = 500;
const MINERU_TIMEOUT_MS = 300_000;
const PYTHON_CMD = process.platform === "win32" ? "python" : "python3";

function isSupported(ext: string): boolean {
  return DOC_EXTS.has(ext) || IMAGE_EXTS.has(ext);
}

// ─── Readers ────────────────────────────────────────

interface MinerUScriptSuccess {
  ok: true;
  markdown_path: string;
  images_dir?: string;
  chars?: number;
}

interface MinerUScriptFailure {
  ok: false;
  error: string;
}

type MinerUScriptResult = MinerUScriptSuccess | MinerUScriptFailure;

function resolveMinerUScriptPath(): string {
  const candidates = [
    fileURLToPath(new URL("../scripts/mineru_upload.py", import.meta.url)),
    resolve(process.cwd(), "src/scripts/mineru_upload.py"),
    resolve(process.cwd(), "dist/scripts/mineru_upload.py"),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return candidates[0];
}

function parseMineruOutput(stdout: string): MinerUScriptResult {
  const trimmed = stdout.trim();
  if (!trimmed) {
    throw new Error("MinerU returned empty stdout");
  }

  const parseOne = (raw: string): MinerUScriptResult | null => {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (parsed.ok === true) {
        if (typeof parsed.markdown_path !== "string" || !parsed.markdown_path.trim()) {
          throw new Error("MinerU missing markdown_path");
        }
        return {
          ok: true,
          markdown_path: parsed.markdown_path,
          images_dir: typeof parsed.images_dir === "string" ? parsed.images_dir : undefined,
          chars: typeof parsed.chars === "number" ? parsed.chars : undefined,
        };
      }

      if (parsed.ok === false) {
        return {
          ok: false,
          error: typeof parsed.error === "string" ? parsed.error : "MinerU parse failed",
        };
      }

      return null;
    } catch {
      return null;
    }
  };

  const direct = parseOne(trimmed);
  if (direct) return direct;

  const lines = trimmed.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const parsed = parseOne(lines[i]);
    if (parsed) return parsed;
  }

  throw new Error(`Invalid MinerU output: ${trimmed.slice(0, 500)}`);
}

async function readViaMinerU(
  filePath: string,
  token: string,
  outputDir: string,
  signal?: AbortSignal,
): Promise<{ text: string; markdownPath: string; imagesDir?: string; chars: number }> {
  const scriptPath = resolveMinerUScriptPath();
  if (!existsSync(scriptPath)) {
    throw new Error(`MinerU script not found: ${scriptPath}`);
  }

  mkdirSync(outputDir, { recursive: true });

  const args = [
    scriptPath,
    filePath,
    "--token",
    token,
    "--output-dir",
    outputDir,
    "--language",
    "ch",
    "--timeout",
    "600",
  ];

  return new Promise((resolveResult, reject) => {
    const child = spawn(PYTHON_CMD, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PYTHONUNBUFFERED: "1", PYTHONIOENCODING: "utf-8" },
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let aborted = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, MINERU_TIMEOUT_MS);

    const onAbort = () => {
      aborted = true;
      clearTimeout(timer);
      child.kill("SIGKILL");
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf-8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf-8");
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(new Error(`Failed to spawn MinerU script: ${err.message}`));
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);

      if (timedOut) {
        reject(new Error("MinerU parsing timeout after 300s"));
        return;
      }
      if (aborted) {
        reject(new Error("MinerU parsing cancelled"));
        return;
      }

      let result: MinerUScriptResult;
      try {
        result = parseMineruOutput(stdout);
      } catch (parseErr) {
        if (code !== 0) {
          const stderrSnippet = stderr.trim().slice(0, 500);
          reject(new Error(`MinerU script exited with code ${code}${stderrSnippet ? `: ${stderrSnippet}` : ""}`));
          return;
        }
        reject(parseErr as Error);
        return;
      }

      if (!result.ok) {
        reject(new Error(result.error || "MinerU parse failed"));
        return;
      }

      if (code !== 0) {
        const stderrSnippet = stderr.trim().slice(0, 500);
        reject(new Error(`MinerU script exited with code ${code}${stderrSnippet ? `: ${stderrSnippet}` : ""}`));
        return;
      }

      const markdownPath = resolve(outputDir, result.markdown_path);
      if (!existsSync(markdownPath)) {
        reject(new Error(`MinerU markdown not found: ${markdownPath}`));
        return;
      }

      const text = readFileSync(markdownPath, "utf-8").trim();
      resolveResult({
        text: text || "(empty document)",
        markdownPath,
        imagesDir: result.images_dir,
        chars: typeof result.chars === "number" ? result.chars : text.length,
      });
    });
  });
}

interface XlsxReadResult {
  text: string;
  sheetNames: string[];
  selectedSheet: string;
  totalRows: number;
  shownRows: number;
}

async function readXlsx(filePath: string, sheet?: string, maxRows?: number): Promise<XlsxReadResult> {
  const ExcelJS = await import("exceljs");
  const workbook = new ExcelJS.default.Workbook();
  await workbook.xlsx.readFile(filePath);

  const sheetNames = workbook.worksheets.map((s) => s.name);

  // Select sheet
  let ws;
  if (sheet) {
    const idx = parseInt(sheet, 10);
    ws = isNaN(idx) ? workbook.getWorksheet(sheet) : workbook.getWorksheet(idx);
  }
  ws ??= workbook.worksheets[0];
  if (!ws) {
    return {
      text: "(no sheets found)",
      sheetNames,
      selectedSheet: "",
      totalRows: 0,
      shownRows: 0,
    };
  }

  const limit = maxRows || 500;
  const rows: string[][] = [];
  ws.eachRow({ includeEmpty: false }, (row, rowNum) => {
    if (rowNum > limit + 1) return; // +1 for header
    const cells: string[] = [];
    row.eachCell({ includeEmpty: true }, (cell) => {
      cells.push(String(cell.value ?? ""));
    });
    rows.push(cells);
  });

  if (rows.length === 0) {
    return {
      text: "(empty sheet)",
      sheetNames,
      selectedSheet: ws.name,
      totalRows: Math.max(ws.rowCount - 1, 0),
      shownRows: 0,
    };
  }

  const shownRows = Math.max(rows.length - 1, 0);
  const totalRows = Math.max(ws.rowCount - 1, 0);

  // Format as markdown table
  const header = rows[0];
  const lines = [
    `Sheet: ${ws.name} (${shownRows} rows shown)`,
    "",
    "| " + header.join(" | ") + " |",
    "| " + header.map(() => "---").join(" | ") + " |",
    ...rows.slice(1).map((r) => "| " + r.join(" | ") + " |"),
  ];

  if (totalRows > limit) {
    lines.push("", `(truncated, showing ${limit} of ${totalRows} data rows)`);
  }

  if (sheetNames.length > 1) {
    lines.push("", `Sheets: ${sheetNames.join(", ")}`);
  }

  return {
    text: lines.join("\n"),
    sheetNames,
    selectedSheet: ws.name,
    totalRows,
    shownRows,
  };
}

interface CsvReadResult {
  text: string;
  rowCount: number;
  shownRows: number;
}

async function readCsv(filePath: string, maxRows?: number): Promise<CsvReadResult> {
  const { parse } = await import("csv-parse/sync");
  const content = readFileSync(filePath, "utf-8");
  const records = parse(content, { columns: true, skip_empty_lines: true, relax_column_count: true }) as Record<string, string>[];

  const limit = maxRows || 500;
  const sliced = records.slice(0, limit);
  if (sliced.length === 0) {
    return { text: "(empty CSV)", rowCount: 0, shownRows: 0 };
  }

  const keys = Object.keys(sliced[0]);
  const lines = [
    `CSV (${records.length} rows)`,
    "",
    "| " + keys.join(" | ") + " |",
    "| " + keys.map(() => "---").join(" | ") + " |",
    ...sliced.map((r) => "| " + keys.map((k) => r[k] ?? "").join(" | ") + " |"),
  ];

  if (records.length > limit) {
    lines.push("", `(truncated, showing ${limit} of ${records.length} rows)`);
  }

  return {
    text: lines.join("\n"),
    rowCount: records.length,
    shownRows: sliced.length,
  };
}

function buildPreview(text: string, maxChars = SUMMARY_PREVIEW_CHARS): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return "(empty content)";
  if (normalized.length <= maxChars) return normalized;
  return normalized.slice(0, maxChars) + "…";
}

function buildSummaryHeader(
  ext: string,
  text: string,
  meta: {
    pageCount?: number;
    sheetNames?: string[];
    csvRows?: number;
  },
): string {
  const parts = [`format=${ext.replace(/^\./, "")}`, `chars=${text.length}`];
  if (typeof meta.pageCount === "number" && meta.pageCount > 0) {
    parts.push(`pages=${meta.pageCount}`);
  }
  if (typeof meta.csvRows === "number") {
    parts.push(`rows=${meta.csvRows}`);
  }
  if (meta.sheetNames && meta.sheetNames.length > 0) {
    parts.push(`sheets=${meta.sheetNames.join(", ")}`);
  }
  return `Document indexed to memory (${parts.join(", ")}): ${buildPreview(text)}`;
}

function buildIndexedDocument(
  filePath: string,
  ext: string,
  text: string,
  meta: {
    pageCount?: number;
    sheetNames?: string[];
    csvRows?: number;
  },
): string {
  const lines = [
    `# ${basename(filePath)}`,
    `Source path: ${filePath}`,
    `Format: ${ext.replace(/^\./, "")}`,
  ];

  if (typeof meta.pageCount === "number" && meta.pageCount > 0) {
    lines.push(`PDF pages: ${meta.pageCount}`);
  }
  if (typeof meta.csvRows === "number") {
    lines.push(`CSV rows: ${meta.csvRows}`);
  }
  if (meta.sheetNames && meta.sheetNames.length > 0) {
    lines.push(`Sheets: ${meta.sheetNames.join(", ")}`);
  }

  lines.push("", text);
  return lines.join("\n");
}

// ─── Extension Factory ──────────────────────────────

export function createReadDocumentExtension(
  workspaceDir: string,
  memoryRootDir: string,
  storeConfig: MemoryStoreConfig,
  mineruToken: string,
): ExtensionFactory {
  return (pi) => {
    const store = getMemoryStore(memoryRootDir, storeConfig);

    const tool: ToolDefinition<typeof ReadDocumentParams> = {
      name: "read_document",
      label: "Read Document",
      description:
        "Read and extract content from documents and images. " +
        "Supports: docx, xlsx, csv, pdf, pptx, and images (png/jpg/etc via native read). " +
        "Returns extracted text in markdown format.",
      parameters: ReadDocumentParams,
      execute: async (_toolCallId, params: Static<typeof ReadDocumentParams>, signal?: AbortSignal) => {
        const filePath = resolve(workspaceDir, params.path);
        const ext = extname(filePath).toLowerCase();
        const docsDir = join(memoryRootDir, "documents");

        if (!existsSync(filePath)) {
          return {
            content: [{ type: "text" as const, text: `Error: file not found: ${filePath}` }],
            details: {},
          };
        }

        if (!isSupported(ext)) {
          return {
            content: [{ type: "text" as const, text: `Error: unsupported format '${ext}'. Supported: docx, xlsx, csv, pdf, pptx, png, jpg, etc.` }],
            details: {},
          };
        }

        try {
          let text: string;
          let pageCount: number | undefined;
          let sheetNames: string[] | undefined;
          let csvRows: number | undefined;

          // Images → model can see them natively via read tool, no need for OCR
          if (IMAGE_EXTS.has(ext)) {
            return {
              content: [{ type: "text" as const, text: `Image files can be viewed directly with the read tool — use read("${params.path}") instead. The model has native vision capabilities.` }],
              details: { path: filePath, method: "redirect" },
            };
          }

          if (MINERU_DOC_EXTS.has(ext) && !mineruToken.trim()) {
            return {
              content: [{ type: "text" as const, text: "请在管理后台配置 MinerU Token" }],
              details: { path: filePath, format: ext },
            };
          }

          switch (ext) {
            case ".docx":
            case ".doc":
            case ".pdf":
            case ".pptx":
            case ".ppt": {
              const mineru = await readViaMinerU(filePath, mineruToken, docsDir, signal);
              text = mineru.text;
              break;
            }

            case ".xlsx":
            case ".xls":
              {
                const xlsx = await readXlsx(filePath, params.sheet, params.max_rows);
                text = xlsx.text;
                sheetNames = xlsx.sheetNames;
              }
              break;

            case ".csv":
              {
                const csv = await readCsv(filePath, params.max_rows);
                text = csv.text;
                csvRows = csv.rowCount;
              }
              break;

            default:
              text = "(unsupported format)";
          }

          if (text.length > LARGE_CONTENT_THRESHOLD) {
            const docFileName = `${basename(filePath)}.md`;
            const docPath = join(docsDir, docFileName);
            const source = `doc/${docFileName}`;
            const meta = { pageCount, sheetNames, csvRows };

            try {
              const indexedDocument = buildIndexedDocument(filePath, ext, text, meta);
              mkdirSync(docsDir, { recursive: true });
              writeFileSync(docPath, indexedDocument, "utf-8");

              store.removeBySource(source);
              const chunks = chunkMarkdown(indexedDocument, source);
              if (chunks.length > 0) {
                store.upsert(chunks);
              }

              const summaryHeader = buildSummaryHeader(ext, text, meta);
              return {
                content: [{
                  type: "text" as const,
                  text:
                    `${summaryHeader}\n` +
                    `Full content indexed to memory as ${source}. Use memory_search to find specific details.\n` +
                    `Stored file: ${docPath}`,
                }],
                details: {
                  path: filePath,
                  format: ext,
                  indexedToMemory: true,
                  source,
                  memoryPath: docPath,
                  extractedChars: text.length,
                },
              };
            } catch (indexErr) {
              const summaryHeader = buildSummaryHeader(ext, text, meta);
              return {
                content: [{
                  type: "text" as const,
                  text:
                    `${summaryHeader}\n` +
                    `Warning: failed to index this document to memory: ${(indexErr as Error).message}`,
                }],
                details: {
                  path: filePath,
                  format: ext,
                  indexedToMemory: false,
                  extractedChars: text.length,
                },
              };
            }
          }

          return {
            content: [{ type: "text" as const, text }],
            details: {
              path: filePath,
              format: ext,
              indexedToMemory: false,
              extractedChars: text.length,
              pageCount,
              sheetNames,
              csvRows,
            },
          };
        } catch (err) {
          return {
            content: [{ type: "text" as const, text: `Error reading ${ext} file: ${(err as Error).message}` }],
            details: {},
          };
        }
      },
    };

    pi.registerTool(tool);
  };
}
