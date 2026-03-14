import {
  ChevronLeft,
  ChevronRight,
  LoaderCircle,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import type { FilePreview } from "../types";
import { formatSize } from "../lib/file-utils";
import DOMPurify from "dompurify";

const LazyMarkdown = lazy(() => import("./Markdown"));

/* ===== Shared Types ===== */

export type PreviewMetadata = Record<string, string | number | boolean | null>;

export interface XlsxResult {
  sheetNames: string[];
  htmlMap: Record<string, string>;
}

/* ===== Shared Helpers ===== */

export async function renderDocx(base64: string): Promise<string> {
  const mammoth = await import("mammoth");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const result = await mammoth.convertToHtml({ arrayBuffer: bytes.buffer });
  return result.value;
}

export async function renderXlsx(base64: string): Promise<XlsxResult> {
  const XLSX = await import("xlsx");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const workbook = XLSX.read(bytes, { type: "array" });
  const htmlMap: Record<string, string> = {};
  for (const name of workbook.SheetNames) {
    htmlMap[name] = XLSX.utils.sheet_to_html(workbook.Sheets[name]);
  }
  return { sheetNames: workbook.SheetNames, htmlMap };
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "--:--";
  const total = Math.round(seconds);
  const mins = Math.floor(total / 60).toString().padStart(2, "0");
  const secs = (total % 60).toString().padStart(2, "0");
  return `${mins}:${secs}`;
}

function formatMetadataValue(value: string | number | boolean | null): string {
  if (value === null) return "-";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return String(value);
}

function humanizeMetadataKey(key: string): string {
  if (key === "modifiedAt") return "Modified";
  return key
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (letter) => letter.toUpperCase());
}

export function parseArchiveTree(entries: string[]): string[] {
  const normalized = entries.map((entry) => entry.replace(/\\/g, "/").replace(/\/+/g, "/"));
  const lines: string[] = [];
  const seenDirectories = new Set<string>();

  for (const entry of normalized) {
    if (entry.startsWith("... and ")) { lines.push(entry); continue; }
    const cleaned = entry.replace(/\/$/, "");
    if (!cleaned) continue;
    const parts = cleaned.split("/").filter(Boolean);
    if (!parts.length) continue;

    for (let idx = 0; idx < parts.length - 1; idx += 1) {
      const currentPath = parts.slice(0, idx + 1).join("/");
      if (seenDirectories.has(currentPath)) continue;
      seenDirectories.add(currentPath);
      lines.push(`${"  ".repeat(idx)}${parts[idx]}/`);
    }

    const isDirectory = entry.endsWith("/");
    const leaf = parts[parts.length - 1];
    const indent = "  ".repeat(Math.max(parts.length - 1, 0));
    if (isDirectory) {
      const dirPath = parts.join("/");
      if (!seenDirectories.has(dirPath)) {
        seenDirectories.add(dirPath);
        lines.push(`${indent}${leaf}/`);
      }
      continue;
    }
    lines.push(`${indent}${leaf}`);
  }
  return lines;
}

export function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  const lines = text.split("\n").filter((l) => l.trim());
  if (lines.length === 0) return { headers: [], rows: [] };

  const parseLine = (line: string): string[] => {
    const result: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"' && line[i + 1] === '"') { current += '"'; i++; }
        else if (ch === '"') inQuotes = false;
        else current += ch;
      } else {
        if (ch === '"') inQuotes = true;
        else if (ch === ",") { result.push(current.trim()); current = ""; }
        else current += ch;
      }
    }
    result.push(current.trim());
    return result;
  };

  const headers = parseLine(lines[0]);
  const rows = lines.slice(1).map(parseLine);
  return { headers, rows };
}

export const CLAMP_PDF_ZOOM = (v: number) => Math.round(Math.max(0.5, Math.min(3, v)) * 100) / 100;

/* ===== PDF Preview ===== */

export function PdfPreviewContent({ fileUrl }: { fileUrl: string }) {
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [pdfZoom, setPdfZoom] = useState(1.0);
  const [loading, setLoading] = useState(true);
  const [renderError, setRenderError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const docRef = useRef<PDFDocumentProxy | null>(null);

  useEffect(() => {
    let disposed = false;
    setPage(1);
    setPageCount(0);
    setLoading(true);
    setRenderError(null);

    void import("pdfjs-dist")
      .then(async (pdfjs) => {
        if (disposed) return;
        pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
        const loadingTask = pdfjs.getDocument(fileUrl);
        const doc = await loadingTask.promise;
        if (disposed) { await doc.destroy(); return; }
        docRef.current = doc;
        setPdfDoc(doc);
        setPageCount(doc.numPages || 0);
      })
      .catch((err) => { if (!disposed) setRenderError(String(err)); })
      .finally(() => { if (!disposed) setLoading(false); });

    return () => {
      disposed = true;
      if (docRef.current?.destroy) void docRef.current.destroy();
      docRef.current = null;
      setPdfDoc(null);
    };
  }, [fileUrl]);

  useEffect(() => {
    if (!pdfDoc || !canvasRef.current) return;
    let cancelled = false;
    let renderTask: RenderTask | null = null;

    const renderPage = async () => {
      try {
        setLoading(true);
        const pageProxy = await pdfDoc.getPage(page);
        if (cancelled) return;

        const rawViewport = pageProxy.getViewport({ scale: 1 });
        const available = frameRef.current?.clientWidth || rawViewport.width;
        const baseScale = Math.max(0.75, Math.min(2, available / rawViewport.width));
        const viewport = pageProxy.getViewport({ scale: baseScale * pdfZoom });

        const canvas = canvasRef.current;
        if (!canvas) return;
        const context = canvas.getContext("2d", { alpha: false });
        if (!context) return;

        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);

        renderTask = pageProxy.render({ canvasContext: context, viewport });
        await renderTask.promise;
      } catch (err) {
        if (!cancelled) setRenderError(String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void renderPage();
    return () => { cancelled = true; if (renderTask?.cancel) renderTask.cancel(); };
  }, [pdfDoc, page, pdfZoom]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") setPage((p) => Math.max(1, p - 1));
      else if (e.key === "ArrowRight") setPage((p) => Math.min(pageCount, p + 1));
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [pageCount]);

  return (
    <div className="preview-pdf">
      <div className="preview-pdf-toolbar">
        <button className="preview-nav-btn" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
          <ChevronLeft size={14} />
        </button>
        <span className="preview-pdf-page">{page} / {Math.max(pageCount, 1)}</span>
        <button className="preview-nav-btn" onClick={() => setPage((p) => Math.min(pageCount, p + 1))} disabled={page >= pageCount}>
          <ChevronRight size={14} />
        </button>
        <span className="preview-pdf-divider" />
        <button className="preview-zoom-btn" onClick={() => setPdfZoom((z) => CLAMP_PDF_ZOOM(z - 0.25))} title="缩小">
          <ZoomOut size={14} />
        </button>
        <span className="preview-zoom-label">{Math.round(pdfZoom * 100)}%</span>
        <button className="preview-zoom-btn" onClick={() => setPdfZoom((z) => CLAMP_PDF_ZOOM(z + 0.25))} title="放大">
          <ZoomIn size={14} />
        </button>
      </div>

      {renderError ? (
        <div className="preview-error">{renderError}</div>
      ) : (
        <div className="preview-pdf-frame" ref={frameRef}>
          {loading && (
            <div className="preview-loading-inline">
              <LoaderCircle size={16} className="spinning" />
              <span>渲染页面中...</span>
            </div>
          )}
          <canvas ref={canvasRef} className="preview-pdf-canvas" />
        </div>
      )}
    </div>
  );
}

/* ===== Video / Audio ===== */

export function VideoPreviewContent({ fileUrl }: { fileUrl: string }) {
  const [duration, setDuration] = useState(0);
  const [width, setWidth] = useState(0);
  const [height, setHeight] = useState(0);

  return (
    <div className="preview-media">
      <video
        className="preview-video"
        src={fileUrl}
        controls
        preload="metadata"
        onLoadedMetadata={(event) => {
          setDuration(event.currentTarget.duration || 0);
          setWidth(event.currentTarget.videoWidth || 0);
          setHeight(event.currentTarget.videoHeight || 0);
        }}
      />
      <div className="preview-media-meta">Duration {formatDuration(duration)} · {width}×{height}</div>
    </div>
  );
}

export function AudioPreviewContent({ fileUrl }: { fileUrl: string }) {
  const [duration, setDuration] = useState(0);

  return (
    <div className="preview-media audio">
      <audio
        className="preview-audio"
        src={fileUrl}
        controls
        preload="metadata"
        onLoadedMetadata={(event) => setDuration(event.currentTarget.duration || 0)}
      />
      <div className="preview-media-meta">Duration {formatDuration(duration)}</div>
    </div>
  );
}

/* ===== Archive ===== */

export function ArchivePreviewContent({ entries, metadata }: { entries: string[]; metadata: PreviewMetadata | null }) {
  const treeLines = useMemo(() => parseArchiveTree(entries), [entries]);
  const entryCount = metadata?.entryCount;
  const header = typeof entryCount === "number" ? `${entryCount} entries` : `${entries.length} entries`;

  return (
    <div className="preview-archive">
      <div className="preview-archive-header">{header}</div>
      <pre className="preview-archive-tree">{treeLines.join("\n")}</pre>
    </div>
  );
}

/* ===== Design ===== */

export function DesignPreviewContent({ preview }: { preview: FilePreview }) {
  const metadata = preview.metadata || {};
  const rows = Object.entries(metadata);

  return (
    <div className="preview-design">
      <div className="preview-design-icon" data-ext={preview.ext} />
      <div className="preview-design-title">设计文件预览占位</div>
      <div className="preview-design-subtitle">当前展示元信息，后续可按格式增加专用渲染器。</div>
      <div className="preview-design-meta">Size {formatSize(preview.size)}</div>
      {rows.length > 0 && (
        <div className="preview-design-grid">
          {rows.map(([key, value]) => (
            <div className="preview-design-row" key={key}>
              <span>{humanizeMetadataKey(key)}</span>
              <span>{key === "modifiedAt" && typeof value === "number"
                ? new Date(value * 1000).toLocaleString()
                : formatMetadataValue(value)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ===== CSV Table ===== */

export function CsvPreviewContent({
  content,
  sort,
  onSort,
}: {
  content: string;
  sort: { col: number; asc: boolean } | null;
  onSort: (s: { col: number; asc: boolean } | null) => void;
}) {
  const { headers, rows } = useMemo(() => parseCsv(content), [content]);

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const { col, asc } = sort;
    return [...rows].sort((a, b) => {
      const va = a[col] || "";
      const vb = b[col] || "";
      const na = Number(va);
      const nb = Number(vb);
      if (!Number.isNaN(na) && !Number.isNaN(nb)) return asc ? na - nb : nb - na;
      return asc ? va.localeCompare(vb) : vb.localeCompare(va);
    });
  }, [rows, sort]);

  const handleSort = (col: number) => {
    if (sort && sort.col === col) {
      onSort(sort.asc ? { col, asc: false } : null);
    } else {
      onSort({ col, asc: true });
    }
  };

  return (
    <div className="preview-csv">
      <div className="preview-csv-header">{rows.length} 行 · {headers.length} 列</div>
      <div className="preview-csv-table-wrap">
        <table className="preview-csv-table">
          <thead>
            <tr>
              {headers.map((h, i) => (
                <th key={i} onClick={() => handleSort(i)} className="preview-csv-th">
                  {h}
                  {sort?.col === i && <span className="preview-csv-sort">{sort.asc ? " ▲" : " ▼"}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((row, ri) => (
              <tr key={ri}>
                {headers.map((_, ci) => (
                  <td key={ci}>{row[ci] || ""}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ===== XLSX Multi-Sheet ===== */

export function XlsxPreviewContent({
  xlsxData,
  activeSheet,
  onSheetChange,
}: {
  xlsxData: XlsxResult;
  activeSheet: string;
  onSheetChange: (name: string) => void;
}) {
  const html = xlsxData.htmlMap[activeSheet] || "";

  return (
    <div className="preview-xlsx">
      {xlsxData.sheetNames.length > 1 && (
        <div className="preview-xlsx-tabs">
          {xlsxData.sheetNames.map((name) => (
            <button
              key={name}
              className={`preview-xlsx-tab${name === activeSheet ? " active" : ""}`}
              onClick={() => onSheetChange(name)}
            >
              {name}
            </button>
          ))}
        </div>
      )}
      <div className="preview-doc" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(html) }} />
    </div>
  );
}

/* ===== Binary ===== */

export function BinaryInfo({ preview }: { preview: FilePreview }) {
  return (
    <div className="preview-binary">
      <div className="preview-binary-icon" data-ext={preview.ext} />
      <span className="preview-binary-name">{preview.name}</span>
      <span className="preview-binary-size">{formatSize(preview.size)}</span>
      <span className="preview-binary-hint">此文件类型不支持预览</span>
    </div>
  );
}

/* ===== Markdown ===== */

export function MarkdownPreviewContent({ content }: { content: string }) {
  return (
    <div className="preview-doc markdown-body">
      <Suspense fallback={<pre style={{ whiteSpace: "pre-wrap" }}>{content}</pre>}>
        <LazyMarkdown content={content} />
      </Suspense>
    </div>
  );
}
