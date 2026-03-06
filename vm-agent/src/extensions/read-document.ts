import { Type, type Static } from "@sinclair/typebox";
import type { ExtensionFactory, ToolDefinition } from "@mariozechner/pi-coding-agent";
import { readFileSync, existsSync } from "node:fs";
import { resolve, extname } from "node:path";

// ─── Parameter Schema ───────────────────────────────

const ReadDocumentParams = Type.Object({
  path: Type.String({ description: "File path (relative to workspace or absolute)" }),
  sheet: Type.Optional(
    Type.String({ description: "Sheet name or 1-based index for Excel files (default: first sheet)" }),
  ),
  max_rows: Type.Optional(
    Type.Number({ description: "Max rows to return for Excel/CSV (default: 500)" }),
  ),
  ocr: Type.Optional(
    Type.Boolean({ description: "Force OCR via vision model (for scanned PDFs or images, default: auto-detect)" }),
  ),
});

// ─── Supported extensions ───────────────────────────

const DOC_EXTS = new Set([".docx", ".doc", ".xlsx", ".xls", ".csv", ".pdf", ".pptx", ".ppt"]);
const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".tiff", ".tif"]);

function isSupported(ext: string): boolean {
  return DOC_EXTS.has(ext) || IMAGE_EXTS.has(ext);
}

// ─── Readers ────────────────────────────────────────

async function readDocx(filePath: string): Promise<string> {
  const mammoth = await import("mammoth");
  const result = await mammoth.default.extractRawText({ path: filePath });
  return result.value.trim() || "(empty document)";
}

async function readXlsx(filePath: string, sheet?: string, maxRows?: number): Promise<string> {
  const ExcelJS = await import("exceljs");
  const workbook = new ExcelJS.default.Workbook();
  await workbook.xlsx.readFile(filePath);

  // Select sheet
  let ws;
  if (sheet) {
    const idx = parseInt(sheet, 10);
    ws = isNaN(idx) ? workbook.getWorksheet(sheet) : workbook.getWorksheet(idx);
  }
  ws ??= workbook.worksheets[0];
  if (!ws) return "(no sheets found)";

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

  if (rows.length === 0) return "(empty sheet)";

  // Format as markdown table
  const header = rows[0];
  const lines = [
    `Sheet: ${ws.name} (${rows.length} rows)`,
    "",
    "| " + header.join(" | ") + " |",
    "| " + header.map(() => "---").join(" | ") + " |",
    ...rows.slice(1).map((r) => "| " + r.join(" | ") + " |"),
  ];

  if (ws.rowCount > limit + 1) {
    lines.push("", `(truncated, showing ${limit} of ${ws.rowCount - 1} data rows)`);
  }

  // List all sheets
  const sheetNames = workbook.worksheets.map((s) => s.name);
  if (sheetNames.length > 1) {
    lines.push("", `Sheets: ${sheetNames.join(", ")}`);
  }

  return lines.join("\n");
}

async function readCsv(filePath: string, maxRows?: number): Promise<string> {
  const { parse } = await import("csv-parse/sync");
  const content = readFileSync(filePath, "utf-8");
  const records = parse(content, { columns: true, skip_empty_lines: true, relax_column_count: true }) as Record<string, string>[];

  const limit = maxRows || 500;
  const sliced = records.slice(0, limit);
  if (sliced.length === 0) return "(empty CSV)";

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

  return lines.join("\n");
}

async function readPdf(filePath: string, _pages?: string): Promise<{ text: string; pageCount: number }> {
  const { PDFParse } = await import("pdf-parse");
  const buf = readFileSync(filePath);
  const parser = new PDFParse({ data: new Uint8Array(buf) });
  const info = await parser.getInfo();
  const result = await parser.getText();

  return { text: result.text.trim(), pageCount: info.total };
}

// ─── OCR via Gemini Flash ───────────────────────────

export async function ocrWithVision(
  proxyUrl: string,
  proxyKey: string,
  filePath: string,
): Promise<string> {
  const buf = readFileSync(filePath);
  const ext = extname(filePath).toLowerCase();
  const mimeMap: Record<string, string> = {
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".gif": "image/gif", ".webp": "image/webp", ".bmp": "image/bmp",
    ".tiff": "image/tiff", ".tif": "image/tiff", ".pdf": "application/pdf",
  };
  const mime = mimeMap[ext] || "application/octet-stream";
  const b64 = buf.toString("base64");

  const res = await fetch(`${proxyUrl}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${proxyKey}`,
    },
    body: JSON.stringify({
      model: "gemini-3-flash-preview",
      messages: [{
        role: "user",
        content: [
          { type: "text", text: "Extract all text content from this document/image. Preserve structure, tables, and formatting as much as possible. Output in markdown format. If the document contains tables, format them as markdown tables." },
          { type: "image_url", image_url: { url: `data:${mime};base64,${b64}` } },
        ],
      }],
      max_tokens: 8192,
    }),
    signal: AbortSignal.timeout(120_000),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OCR API error: HTTP ${res.status} — ${errText.slice(0, 300)}`);
  }

  const data = await res.json() as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("OCR returned empty content");
  return text;
}

// ─── Extension Factory ──────────────────────────────

export function createReadDocumentExtension(
  proxyUrl: string,
  proxyKey: string,
  workspaceDir: string,
): ExtensionFactory {
  return (pi) => {
    const tool: ToolDefinition<typeof ReadDocumentParams> = {
      name: "read_document",
      label: "Read Document",
      description:
        "Read and extract content from documents and images. " +
        "Supports: docx, xlsx, csv, pdf, pptx, and images (png/jpg/etc via OCR). " +
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

          // Images → OCR directly
          if (IMAGE_EXTS.has(ext)) {
            text = await ocrWithVision(proxyUrl, proxyKey, filePath);
            return {
              content: [{ type: "text" as const, text: `[OCR: ${filePath}]\n\n${text}` }],
              details: { path: filePath, method: "ocr" },
            };
          }

          switch (ext) {
            case ".docx":
            case ".doc":
              text = await readDocx(filePath);
              break;

            case ".xlsx":
            case ".xls":
              text = await readXlsx(filePath, params.sheet, params.max_rows);
              break;

            case ".csv":
              text = await readCsv(filePath, params.max_rows);
              break;

            case ".pdf": {
              const pdf = await readPdf(filePath);
              // Auto-detect scanned PDF: very little text relative to page count
              const isScanned = params.ocr || (pdf.text.length < pdf.pageCount * 50);
              if (isScanned && proxyKey) {
                try {
                  text = await ocrWithVision(proxyUrl, proxyKey, filePath);
                  text = `[OCR: ${filePath}, ${pdf.pageCount} pages]\n\n${text}`;
                } catch {
                  // Fallback to raw text if OCR fails
                  text = pdf.text || "(scanned PDF — OCR failed, no extractable text)";
                }
              } else {
                text = pdf.text || "(no extractable text)";
              }
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

          return {
            content: [{ type: "text" as const, text }],
            details: { path: filePath, format: ext },
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
