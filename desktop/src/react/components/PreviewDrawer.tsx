import { invoke } from "@tauri-apps/api/core";
import hljs from "../lib/hljs-setup";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  ExternalLink,
  FolderOpen,
  LoaderCircle,
  Minus,
  Plus,
  Search,
  WrapText,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import type { FilePreview } from "../types";
import { formatSize } from "../lib/file-utils";
import DOMPurify from "dompurify";

type PreviewMetadata = Record<string, string | number | boolean | null>;

/* ===== Helpers ===== */

async function renderDocx(base64: string): Promise<string> {
  const mammoth = await import("mammoth");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const result = await mammoth.convertToHtml({ arrayBuffer: bytes.buffer });
  return result.value;
}

interface XlsxResult {
  sheetNames: string[];
  htmlMap: Record<string, string>;
}

async function renderXlsx(base64: string): Promise<XlsxResult> {
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

function formatDuration(seconds: number): string {
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

function highlightCode(code: string, language: string | null): string {
  const lang = language && hljs.getLanguage(language) ? language : "plaintext";
  return hljs.highlight(code, { language: lang }).value;
}

function parseArchiveTree(entries: string[]): string[] {
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

function parseCsv(text: string): { headers: string[]; rows: string[][] } {
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

const CLAMP_ZOOM = (v: number) => Math.round(Math.max(0.25, Math.min(5, v)) * 100) / 100;
const CLAMP_PDF_ZOOM = (v: number) => Math.round(Math.max(0.5, Math.min(3, v)) * 100) / 100;

/* ===== Main Component ===== */

export default function PreviewDrawer({
  filePath,
  workspace,
  onClose,
}: {
  filePath: string | null;
  workspace?: string;
  onClose: () => void;
}) {
  const [preview, setPreview] = useState<FilePreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [docHtml, setDocHtml] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewUrlLoading, setPreviewUrlLoading] = useState(false);

  // XLSX multi-sheet
  const [xlsxData, setXlsxData] = useState<XlsxResult | null>(null);
  const [activeSheet, setActiveSheet] = useState("");

  // Resize
  const [drawerWidth, setDrawerWidth] = useState(420);
  const resizingRef = useRef(false);

  // Preview history
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const navigatingRef = useRef(false);

  // Copy path feedback
  const [copied, setCopied] = useState(false);

  // Image zoom / pan
  const [zoomLevel, setZoomLevel] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const [imgDimensions, setImgDimensions] = useState<{ w: number; h: number } | null>(null);
  const panningRef = useRef(false);
  const panStartRef = useRef({ x: 0, y: 0, px: 0, py: 0 });

  // Code search
  const [codeSearchVisible, setCodeSearchVisible] = useState(false);
  const [codeSearch, setCodeSearch] = useState("");
  const [codeMatchIndex, setCodeMatchIndex] = useState(0);
  const [wordWrap, setWordWrap] = useState(false);
  const codeSearchInputRef = useRef<HTMLInputElement>(null);
  const codeAreaRef = useRef<HTMLDivElement>(null);

  // CSV sort
  const [csvSort, setCsvSort] = useState<{ col: number; asc: boolean } | null>(null);

  /* ---- Load preview ---- */
  useEffect(() => {
    if (!filePath) {
      setPreview(null);
      setDocHtml(null);
      setXlsxData(null);
      setPreviewUrl(null);
      setPreviewUrlLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    setDocHtml(null);
    setXlsxData(null);
    setPreviewUrl(null);
    setPreviewUrlLoading(false);
    setZoomLevel(1);
    setPanX(0);
    setPanY(0);
    setImgDimensions(null);
    setCodeSearchVisible(false);
    setCodeSearch("");
    setCsvSort(null);

    invoke<FilePreview>("preview_file", { path: filePath, workspace: workspace || null })
      .then(async (data) => {
        setPreview(data);
        if (data.category === "docx" && data.content) {
          try { setDocHtml(await renderDocx(data.content)); }
          catch (err) { setError(`DOCX parse failed: ${err}`); }
        } else if (data.category === "xlsx" && data.content) {
          try {
            const res = await renderXlsx(data.content);
            setXlsxData(res);
            setActiveSheet(res.sheetNames[0] || "");
          } catch (err) { setError(`XLSX parse failed: ${err}`); }
        }
      })
      .catch((err) => setError(String(err)))
      .finally(() => setLoading(false));
  }, [filePath, workspace]);

  /* ---- History tracking ---- */
  useEffect(() => {
    if (!filePath) return;
    if (navigatingRef.current) { navigatingRef.current = false; return; }
    setHistory((prev) => {
      const trimmed = prev.slice(0, historyIndex + 1);
      return [...trimmed, filePath];
    });
    setHistoryIndex((prev) => prev + 1);
  }, [filePath]);

  const canGoBack = historyIndex > 0;
  const canGoForward = historyIndex < history.length - 1;

  const navigateHistory = useCallback((delta: number) => {
    const newIndex = historyIndex + delta;
    if (newIndex < 0 || newIndex >= history.length) return;
    navigatingRef.current = true;
    setHistoryIndex(newIndex);
    window.dispatchEvent(new CustomEvent("preview-file", { detail: { path: history[newIndex] } }));
  }, [history, historyIndex]);

  /* ---- Keyboard shortcuts ---- */
  useEffect(() => {
    if (!filePath) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (codeSearchVisible) { setCodeSearchVisible(false); setCodeSearch(""); }
        else onClose();
        return;
      }
      // Ctrl/Cmd+F for code search
      if ((event.metaKey || event.ctrlKey) && event.key === "f" && preview?.category === "code") {
        event.preventDefault();
        setCodeSearchVisible(true);
        setTimeout(() => codeSearchInputRef.current?.focus(), 50);
        return;
      }
      // Image zoom with +/-
      if (preview?.category === "image") {
        if (event.key === "+" || event.key === "=") { setZoomLevel((z) => CLAMP_ZOOM(z + 0.25)); return; }
        if (event.key === "-") { setZoomLevel((z) => CLAMP_ZOOM(z - 0.25)); return; }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [filePath, onClose, codeSearchVisible, preview?.category]);

  /* ---- Resize ---- */
  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!resizingRef.current) return;
      const newWidth = window.innerWidth - e.clientX;
      setDrawerWidth(Math.max(300, Math.min(700, newWidth)));
    };
    const onMouseUp = () => { resizingRef.current = false; document.body.style.cursor = ""; };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => { window.removeEventListener("mousemove", onMouseMove); window.removeEventListener("mouseup", onMouseUp); };
  }, []);

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    resizingRef.current = true;
    document.body.style.cursor = "col-resize";
  }, []);

  /* ---- Actions ---- */
  const handleOpen = useCallback(() => {
    if (!filePath) return;
    invoke("open_file_default", { path: filePath, workspace: workspace || null }).catch(console.error);
  }, [filePath, workspace]);

  const handleReveal = useCallback(() => {
    if (!filePath) return;
    invoke("reveal_in_finder", { path: filePath, workspace: workspace || null }).catch(console.error);
  }, [filePath, workspace]);

  const handleCopyPath = useCallback(() => {
    if (!preview?.path) return;
    navigator.clipboard.writeText(preview.path).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [preview?.path]);

  useEffect(() => {
    if (!preview) {
      setPreviewUrl(null);
      setPreviewUrlLoading(false);
      return;
    }

    if (preview.category === "image") {
      setPreviewUrl(preview.content || null);
      setPreviewUrlLoading(false);
      return;
    }

    if (preview.category !== "pdf" && preview.category !== "video" && preview.category !== "audio") {
      setPreviewUrl(null);
      setPreviewUrlLoading(false);
      return;
    }

    let disposed = false;
    setPreviewUrl(null);
    setPreviewUrlLoading(true);

    invoke<string>("read_file_base64", {
      path: preview.path,
      workspace: workspace || null,
    })
      .then((url) => {
        if (disposed) return;
        setPreviewUrl(url);
      })
      .catch((err) => {
        if (disposed) return;
        console.error("[preview] read_file_base64 failed:", err);
        setPreviewUrl(null);
      })
      .finally(() => {
        if (!disposed) {
          setPreviewUrlLoading(false);
        }
      });

    return () => {
      disposed = true;
    };
  }, [preview, workspace]);

  /* ---- Image pan handlers ---- */
  const handleImageWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.25 : 0.25;
    setZoomLevel((z) => CLAMP_ZOOM(z + delta));
  }, []);

  const handleImageMouseDown = useCallback((e: React.MouseEvent) => {
    if (zoomLevel <= 1) return;
    e.preventDefault();
    panningRef.current = true;
    panStartRef.current = { x: e.clientX, y: e.clientY, px: panX, py: panY };
  }, [zoomLevel, panX, panY]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!panningRef.current) return;
      const dx = e.clientX - panStartRef.current.x;
      const dy = e.clientY - panStartRef.current.y;
      setPanX(panStartRef.current.px + dx);
      setPanY(panStartRef.current.py + dy);
    };
    const onUp = () => { panningRef.current = false; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, []);

  const handleImageDoubleClick = useCallback(() => {
    setZoomLevel(1);
    setPanX(0);
    setPanY(0);
  }, []);

  /* ---- Code search logic ---- */
  const codeMatches = useMemo(() => {
    if (!codeSearch || !preview?.content || (preview.category !== "code" && preview.category !== "csv")) return [];
    const lower = preview.content.toLowerCase();
    const query = codeSearch.toLowerCase();
    const indices: number[] = [];
    let pos = 0;
    while ((pos = lower.indexOf(query, pos)) !== -1) {
      indices.push(pos);
      pos += query.length;
    }
    return indices;
  }, [codeSearch, preview?.content, preview?.category]);

  const handleCodeSearchKey = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (codeMatches.length === 0) return;
      if (e.shiftKey) setCodeMatchIndex((i) => (i - 1 + codeMatches.length) % codeMatches.length);
      else setCodeMatchIndex((i) => (i + 1) % codeMatches.length);
    }
    if (e.key === "Escape") { setCodeSearchVisible(false); setCodeSearch(""); }
  }, [codeMatches.length]);

  // Scroll to current match
  useEffect(() => {
    if (!codeSearchVisible || codeMatches.length === 0) return;
    const mark = codeAreaRef.current?.querySelectorAll(".search-match")[codeMatchIndex];
    mark?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [codeMatchIndex, codeSearchVisible, codeMatches.length]);

  /* ---- Highlighted code with search marks ---- */
  const buildCodeHtml = useCallback((content: string, language: string | null): string => {
    const lines = content.split("\n");
    return lines.map((line, index) => {
      let highlighted = highlightCode(line, language);
      if (codeSearch && codeSearchVisible) {
        const query = codeSearch.toLowerCase();
        const lower = highlighted.toLowerCase();
        let result = "";
        let pos = 0;
        // We need to highlight on the raw text but the highlighted HTML has tags
        // Simplified: mark on the original line then highlight
        const rawLine = line;
        const rawLower = rawLine.toLowerCase();
        let markedLine = "";
        let rPos = 0;
        while (rPos < rawLine.length) {
          const idx = rawLower.indexOf(query, rPos);
          if (idx === -1) { markedLine += rawLine.slice(rPos); break; }
          markedLine += rawLine.slice(rPos, idx);
          markedLine += `\x00MARK_START\x00${rawLine.slice(idx, idx + query.length)}\x00MARK_END\x00`;
          rPos = idx + query.length;
        }
        highlighted = highlightCode(markedLine, language)
          .replace(/\x00MARK_START\x00/g, '<mark class="search-match">')
          .replace(/\x00MARK_END\x00/g, "</mark>");
      }
      return `<span class="code-line"><span class="line-number">${index + 1}</span><span class="line-content">${highlighted}</span></span>`;
    }).join("\n");
  }, [codeSearch, codeSearchVisible]);

  /* ---- Render content ---- */
  const renderContent = () => {
    if (loading) {
      return (
        <div className="preview-loading">
          <LoaderCircle size={20} className="spinning" />
          <span>加载中...</span>
        </div>
      );
    }
    if (error) return <div className="preview-error">{error}</div>;
    if (!preview) return <div className="preview-empty">选择文件以预览</div>;

    switch (preview.category) {
      case "image": {
        const source = preview.content || previewUrl;
        return source ? (
          <div className="preview-image-wrap">
            <div
              className="preview-image-container"
              onWheel={handleImageWheel}
              onMouseDown={handleImageMouseDown}
              onDoubleClick={handleImageDoubleClick}
            >
              <img
                className="preview-image"
                src={source}
                alt={preview.name}
                style={{
                  transform: `scale(${zoomLevel}) translate(${panX / zoomLevel}px, ${panY / zoomLevel}px)`,
                  transformOrigin: "top left",
                  cursor: zoomLevel > 1 ? "grab" : "zoom-in",
                }}
                onLoad={(e) => {
                  const img = e.currentTarget;
                  setImgDimensions({ w: img.naturalWidth, h: img.naturalHeight });
                }}
              />
            </div>
            {imgDimensions && (
              <div className="preview-image-info">
                {imgDimensions.w} × {imgDimensions.h}
              </div>
            )}
            <div className="preview-zoom-controls">
              <button className="preview-zoom-btn" onClick={() => setZoomLevel((z) => CLAMP_ZOOM(z - 0.25))} title="缩小">
                <Minus size={14} />
              </button>
              <span className="preview-zoom-label">{Math.round(zoomLevel * 100)}%</span>
              <button className="preview-zoom-btn" onClick={() => setZoomLevel((z) => CLAMP_ZOOM(z + 0.25))} title="放大">
                <Plus size={14} />
              </button>
            </div>
          </div>
        ) : (
          <div className="preview-error">图片无法预览</div>
        );
      }

      case "pdf":
        if (previewUrlLoading) {
          return (
            <div className="preview-loading">
              <LoaderCircle size={20} className="spinning" />
              <span>加载中...</span>
            </div>
          );
        }
        return previewUrl ? <PdfPreviewContent key={preview.path} fileUrl={previewUrl} /> : <BinaryInfo preview={preview} />;

      case "video":
        if (previewUrlLoading) {
          return (
            <div className="preview-loading">
              <LoaderCircle size={20} className="spinning" />
              <span>加载中...</span>
            </div>
          );
        }
        return previewUrl ? <VideoPreviewContent key={preview.path} fileUrl={previewUrl} /> : <BinaryInfo preview={preview} />;

      case "audio":
        if (previewUrlLoading) {
          return (
            <div className="preview-loading">
              <LoaderCircle size={20} className="spinning" />
              <span>加载中...</span>
            </div>
          );
        }
        return previewUrl ? <AudioPreviewContent key={preview.path} fileUrl={previewUrl} /> : <BinaryInfo preview={preview} />;

      case "archive":
        return <ArchivePreviewContent entries={preview.entries || []} metadata={preview.metadata || null} />;

      case "design":
        return <DesignPreviewContent preview={preview} />;

      case "code":
        if (!preview.content) return <div className="preview-error">无法读取文件</div>;
        return (
          <div className="preview-code-wrap" ref={codeAreaRef}>
            {codeSearchVisible && (
              <div className="preview-code-search">
                <Search size={13} className="preview-code-search-icon" />
                <input
                  ref={codeSearchInputRef}
                  className="preview-code-search-input"
                  type="text"
                  placeholder="搜索..."
                  value={codeSearch}
                  onChange={(e) => { setCodeSearch(e.target.value); setCodeMatchIndex(0); }}
                  onKeyDown={handleCodeSearchKey}
                />
                {codeSearch && (
                  <span className="preview-code-search-count">
                    {codeMatches.length > 0 ? `${codeMatchIndex + 1}/${codeMatches.length}` : "0"}
                  </span>
                )}
                <button className="preview-code-search-close" onClick={() => { setCodeSearchVisible(false); setCodeSearch(""); }}>
                  <X size={13} />
                </button>
              </div>
            )}
            <div className="preview-code-toolbar">
              <button
                className={`preview-code-tool-btn${wordWrap ? " active" : ""}`}
                onClick={() => setWordWrap((w) => !w)}
                title={wordWrap ? "关闭自动换行" : "自动换行"}
              >
                <WrapText size={13} />
              </button>
              <button
                className="preview-code-tool-btn"
                onClick={() => { setCodeSearchVisible(true); setTimeout(() => codeSearchInputRef.current?.focus(), 50); }}
                title="搜索 (Ctrl+F)"
              >
                <Search size={13} />
              </button>
            </div>
            <pre className={`preview-code${wordWrap ? " wrap" : ""}`}>
              <code dangerouslySetInnerHTML={{ __html: buildCodeHtml(preview.content, preview.language) }} />
            </pre>
          </div>
        );

      case "markdown":
        if (!preview.content) return <div className="preview-error">无法读取文件</div>;
        return <MarkdownPreviewContent content={preview.content} />;

      case "text":
        return preview.content ? (
          <pre className="preview-text">{preview.content}</pre>
        ) : (
          <div className="preview-error">无法读取文件</div>
        );

      case "csv":
        if (!preview.content) return <div className="preview-error">无法读取文件</div>;
        return <CsvPreviewContent content={preview.content} sort={csvSort} onSort={setCsvSort} />;

      case "docx":
        return docHtml ? (
          <div className="preview-doc" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(docHtml) }} />
        ) : loading ? null : (
          <BinaryInfo preview={preview} />
        );

      case "xlsx":
        return xlsxData ? (
          <XlsxPreviewContent xlsxData={xlsxData} activeSheet={activeSheet} onSheetChange={setActiveSheet} />
        ) : loading ? null : (
          <BinaryInfo preview={preview} />
        );

      default:
        return <BinaryInfo preview={preview} />;
    }
  };

  return (
    <div
      className={`preview-drawer${filePath ? " open" : ""}`}
      style={filePath ? { width: drawerWidth, minWidth: drawerWidth } : undefined}
    >
      <div className="preview-resize-handle" onMouseDown={handleResizeStart} />
      <div className="preview-inner">
        <div className="preview-header">
          <div className="preview-nav">
            <button className="preview-nav-btn" onClick={() => navigateHistory(-1)} disabled={!canGoBack} title="后退">
              <ArrowLeft size={14} />
            </button>
            <button className="preview-nav-btn" onClick={() => navigateHistory(1)} disabled={!canGoForward} title="前进">
              <ArrowRight size={14} />
            </button>
          </div>
          <div className="preview-title-area">
            <span className="preview-name">{preview?.name || "预览"}</span>
            {preview && (
              <span className="preview-meta">
                {preview.ext} · {formatSize(preview.size)}
              </span>
            )}
          </div>
          <div className="preview-actions">
            <button
              className="preview-action-btn"
              onClick={handleCopyPath}
              title="复制路径"
            >
              {copied ? <Check size={15} /> : <Copy size={15} />}
            </button>
            <button
              className="preview-action-btn"
              onClick={handleReveal}
              title="在文件管理器中显示"
            >
              <FolderOpen size={15} />
            </button>
            <button
              className="preview-action-btn"
              onClick={handleOpen}
              title="使用默认应用打开"
            >
              <ExternalLink size={15} />
            </button>
            <button
              className="preview-action-btn"
              onClick={onClose}
              title="关闭预览"
            >
              <X size={15} />
            </button>
          </div>
        </div>
        <div className="preview-content">{renderContent()}</div>
      </div>
    </div>
  );
}

/* ===== PDF Preview ===== */

function PdfPreviewContent({ fileUrl }: { fileUrl: string }) {
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

  // PDF keyboard navigation
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

function VideoPreviewContent({ fileUrl }: { fileUrl: string }) {
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

function AudioPreviewContent({ fileUrl }: { fileUrl: string }) {
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

function ArchivePreviewContent({ entries, metadata }: { entries: string[]; metadata: PreviewMetadata | null }) {
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

function DesignPreviewContent({ preview }: { preview: FilePreview }) {
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

function CsvPreviewContent({
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

function XlsxPreviewContent({
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

/* ===== Binary / Markdown ===== */

function BinaryInfo({ preview }: { preview: FilePreview }) {
  return (
    <div className="preview-binary">
      <div className="preview-binary-icon" data-ext={preview.ext} />
      <span className="preview-binary-name">{preview.name}</span>
      <span className="preview-binary-size">{formatSize(preview.size)}</span>
      <span className="preview-binary-hint">此文件类型不支持预览</span>
    </div>
  );
}

function MarkdownPreviewContent({ content }: { content: string }) {
  const [html, setHtml] = useState("");
  useEffect(() => {
    import("marked").then(({ marked }) => {
      setHtml(DOMPurify.sanitize(marked.parse(content) as string));
    });
  }, [content]);
  if (!html) return null;
  return <div className="preview-doc markdown-body" dangerouslySetInnerHTML={{ __html: html }} />;
}
