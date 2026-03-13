import { Type, type Static } from "@sinclair/typebox";
import type { ExtensionFactory, ToolDefinition } from "@mariozechner/pi-coding-agent";
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, extname, basename, join } from "node:path";
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
const LARGE_CONTENT_THRESHOLD = 2000;
const SUMMARY_PREVIEW_CHARS = 500;

function isSupported(ext: string): boolean {
  return DOC_EXTS.has(ext) || IMAGE_EXTS.has(ext);
}

// ─── Readers ────────────────────────────────────────

async function readDocx(filePath: string): Promise<string> {
  const mammoth = await import("mammoth");
  const result = await mammoth.default.extractRawText({ path: filePath });
  return result.value.trim() || "(empty document)";
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

async function readPdf(filePath: string, _pages?: string): Promise<{ text: string; pageCount: number }> {
  const { PDFParse } = await import("pdf-parse");
  const buf = readFileSync(filePath);
  const parser = new PDFParse({ data: new Uint8Array(buf) });
  const info = await parser.getInfo();
  const result = await parser.getText();

  return { text: result.text.trim(), pageCount: info.total };
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
      execute: async (_toolCallId, params: Static<typeof ReadDocumentParams>) => {
        const filePath = resolve(workspaceDir, params.path);
        const ext = extname(filePath).toLowerCase();

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

          switch (ext) {
            case ".docx":
            case ".doc":
              text = await readDocx(filePath);
              break;

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

            case ".pdf": {
              const pdf = await readPdf(filePath);
              text = pdf.text || "(no extractable text — this may be a scanned PDF)";
              pageCount = pdf.pageCount;
              break;
            }

            case ".pptx":
            case ".ppt":
              // pptx: extract via zip + xml
              text = await readPptx(filePath);
              break;

            default:
              text = "(unsupported format)";
          }

          if (text.length > LARGE_CONTENT_THRESHOLD) {
            const docFileName = `${basename(filePath)}.md`;
            const docsDir = join(memoryRootDir, "documents");
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

// ─── PPTX reader (zip + xml extraction) ─────────────

async function readPptx(filePath: string): Promise<string> {
  // Use jszip to extract slide XML
  const JSZip = (await import("jszip")).default;
  const buf = readFileSync(filePath);
  const zip = await JSZip.loadAsync(buf);

  const slides: string[] = [];
  const slideFiles = Object.keys(zip.files)
    .filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f))
    .sort((a, b) => {
      const na = parseInt(a.match(/slide(\d+)/)?.[1] || "0", 10);
      const nb = parseInt(b.match(/slide(\d+)/)?.[1] || "0", 10);
      return na - nb;
    });

  for (const slideFile of slideFiles) {
    const xml = await zip.files[slideFile].async("text");
    // Extract text from <a:t> tags
    const texts: string[] = [];
    const re = /<a:t>([\s\S]*?)<\/a:t>/g;
    let m;
    while ((m = re.exec(xml)) !== null) {
      const t = m[1].trim();
      if (t) texts.push(t);
    }
    if (texts.length > 0) {
      const num = slideFile.match(/slide(\d+)/)?.[1] || "?";
      slides.push(`## Slide ${num}\n\n${texts.join("\n")}`);
    }
  }

  return slides.length > 0 ? slides.join("\n\n") : "(empty presentation)";
}
