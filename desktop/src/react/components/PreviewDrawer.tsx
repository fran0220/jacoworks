import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import hljs from "highlight.js/lib/core";
import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  FolderOpen,
  LoaderCircle,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { FilePreview } from "../types";

type PreviewMetadata = Record<string, string | number | boolean | null>;

async function renderDocx(base64: string): Promise<string> {
  const mammoth = await import("mammoth");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const result = await mammoth.convertToHtml({ arrayBuffer: bytes.buffer });
  return result.value;
}

async function renderXlsx(base64: string): Promise<string> {
  const XLSX = await import("xlsx");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const workbook = XLSX.read(bytes, { type: "array" });
  const sheetName = workbook.SheetNames[0];
  return XLSX.utils.sheet_to_html(workbook.Sheets[sheetName]);
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "--:--";
  const total = Math.round(seconds);
  const mins = Math.floor(total / 60)
    .toString()
    .padStart(2, "0");
  const secs = (total % 60).toString().padStart(2, "0");
  return `${mins}:${secs}`;
}

function formatMetadataValue(value: string | number | boolean | null): string {
  if (value === null) return "-";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
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
    if (entry.startsWith("... and ")) {
      lines.push(entry);
      continue;
    }

    const cleaned = entry.replace(/\/$/, "");
    if (!cleaned) continue;
    const parts = cleaned.split("/").filter(Boolean);
    if (!parts.length) continue;

    for (let idx = 0; idx < parts.length - 1; idx += 1) {
      const currentPath = parts.slice(0, idx + 1).join("/");
      if (seenDirectories.has(currentPath)) continue;
      seenDirectories.add(currentPath);
      const indent = "  ".repeat(idx);
      lines.push(`${indent}${parts[idx]}/`);
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
  const [imageZoomed, setImageZoomed] = useState(false);

  useEffect(() => {
    if (!filePath) {
      setPreview(null);
      setDocHtml(null);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    setDocHtml(null);
    setImageZoomed(false);

    invoke<FilePreview>("preview_file", {
      path: filePath,
      workspace: workspace || null,
    })
      .then(async (data) => {
        setPreview(data);
        if (data.category === "docx" && data.content) {
          try {
            const html = await renderDocx(data.content);
            setDocHtml(html);
          } catch (err) {
            setError(`DOCX parse failed: ${err}`);
          }
        } else if (data.category === "xlsx" && data.content) {
          try {
            const html = await renderXlsx(data.content);
            setDocHtml(html);
          } catch (err) {
            setError(`XLSX parse failed: ${err}`);
          }
        }
      })
      .catch((err) => setError(String(err)))
      .finally(() => setLoading(false));
  }, [filePath, workspace]);

  useEffect(() => {
    if (!filePath) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [filePath, onClose]);

  const handleOpen = useCallback(() => {
    if (!filePath) return;
    invoke("open_file_default", { path: filePath, workspace: workspace || null }).catch(console.error);
  }, [filePath, workspace]);

  const handleReveal = useCallback(() => {
    if (!filePath) return;
    invoke("reveal_in_finder", { path: filePath, workspace: workspace || null }).catch(console.error);
  }, [filePath, workspace]);

  const previewUrl = useMemo(() => {
    if (!preview) return null;
    try {
      return convertFileSrc(preview.path);
    } catch {
      return null;
    }
  }, [preview]);

  const renderContent = () => {
    if (loading) {
      return (
        <div className="preview-loading">
          <LoaderCircle size={20} className="spinning" />
          <span>加载中...</span>
        </div>
      );
    }
    if (error) {
      return <div className="preview-error">{error}</div>;
    }
    if (!preview) {
      return <div className="preview-empty">选择文件以预览</div>;
    }

    switch (preview.category) {
      case "image": {
        const source = preview.content || previewUrl;
        return source ? (
          <div className="preview-image-wrap">
            <img
              className={`preview-image${imageZoomed ? " zoomed" : ""}`}
              src={source}
              alt={preview.name}
              onClick={() => setImageZoomed((zoomed) => !zoomed)}
            />
          </div>
        ) : (
          <div className="preview-error">图片无法预览</div>
        );
      }

      case "pdf":
        return previewUrl ? <PdfPreviewContent key={preview.path} fileUrl={previewUrl} /> : <BinaryInfo preview={preview} />;

      case "video":
        return previewUrl ? <VideoPreviewContent key={preview.path} fileUrl={previewUrl} /> : <BinaryInfo preview={preview} />;

      case "audio":
        return previewUrl ? <AudioPreviewContent key={preview.path} fileUrl={previewUrl} /> : <BinaryInfo preview={preview} />;

      case "archive":
        return <ArchivePreviewContent entries={preview.entries || []} metadata={preview.metadata || null} />;

      case "design":
        return <DesignPreviewContent preview={preview} />;

      case "code":
        if (!preview.content) return <div className="preview-error">无法读取文件</div>;
        return (
          <div className="preview-code-wrap">
            <pre className="preview-code">
              <code
                dangerouslySetInnerHTML={{
                  __html: preview.content
                    .split("\n")
                    .map((line, index) => {
                      const highlighted = highlightCode(line, preview.language);
                      return `<span class="code-line"><span class="line-number">${index + 1}</span><span class="line-content">${highlighted}</span></span>`;
                    })
                    .join("\n"),
                }}
              />
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

      case "docx":
      case "xlsx":
        return docHtml ? (
          <div className="preview-doc" dangerouslySetInnerHTML={{ __html: docHtml }} />
        ) : loading ? null : (
          <BinaryInfo preview={preview} />
        );

      default:
        return <BinaryInfo preview={preview} />;
    }
  };

  return (
    <div className={`preview-drawer${filePath ? " open" : ""}`}>
      <div className="preview-inner">
        <div className="preview-header">
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

function PdfPreviewContent({ fileUrl }: { fileUrl: string }) {
  const [pdfDoc, setPdfDoc] = useState<any>(null);
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [renderError, setRenderError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const docRef = useRef<any>(null);

  useEffect(() => {
    let disposed = false;
    setPage(1);
    setPageCount(0);
    setLoading(true);
    setRenderError(null);

    void import("pdfjs-dist")
      .then(async (pdfjs) => {
        if (disposed) return;
        (pdfjs as any).GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
        const loadingTask = (pdfjs as any).getDocument(fileUrl);
        const doc = await loadingTask.promise;
        if (disposed) {
          await doc.destroy();
          return;
        }
        docRef.current = doc;
        setPdfDoc(doc);
        setPageCount(doc.numPages || 0);
      })
      .catch((err) => {
        if (!disposed) setRenderError(String(err));
      })
      .finally(() => {
        if (!disposed) setLoading(false);
      });

    return () => {
      disposed = true;
      if (docRef.current?.destroy) {
        void docRef.current.destroy();
      }
      docRef.current = null;
      setPdfDoc(null);
    };
  }, [fileUrl]);

  useEffect(() => {
    if (!pdfDoc || !canvasRef.current) return;
    let cancelled = false;
    let renderTask: any = null;

    const renderPage = async () => {
      try {
        setLoading(true);
        const pageProxy = await pdfDoc.getPage(page);
        if (cancelled) return;

        const rawViewport = pageProxy.getViewport({ scale: 1 });
        const available = frameRef.current?.clientWidth || rawViewport.width;
        const scale = Math.max(0.75, Math.min(2, available / rawViewport.width));
        const viewport = pageProxy.getViewport({ scale });

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

    return () => {
      cancelled = true;
      if (renderTask?.cancel) renderTask.cancel();
    };
  }, [pdfDoc, page]);

  return (
    <div className="preview-pdf">
      <div className="preview-pdf-toolbar">
        <button
          className="preview-nav-btn"
          onClick={() => setPage((current) => Math.max(1, current - 1))}
          disabled={page <= 1}
        >
          <ChevronLeft size={14} />
        </button>
        <span className="preview-pdf-page">{page} / {Math.max(pageCount, 1)}</span>
        <button
          className="preview-nav-btn"
          onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
          disabled={page >= pageCount}
        >
          <ChevronRight size={14} />
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

function ArchivePreviewContent({
  entries,
  metadata,
}: {
  entries: string[];
  metadata: PreviewMetadata | null;
}) {
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
      setHtml(marked.parse(content) as string);
    });
  }, [content]);
  if (!html) return null;
  return <div className="preview-doc markdown-body" dangerouslySetInnerHTML={{ __html: html }} />;
}
