import { invoke } from "@tauri-apps/api/core";
import hljs from "../lib/hljs-setup";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Copy,
  ExternalLink,
  FolderOpen,
  LoaderCircle,
  Minus,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  WrapText,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import FileTreeSidebar from "./FileTreeSidebar";
import type { FilePreview } from "../types";
import { formatSize } from "../lib/file-utils";
import DOMPurify from "dompurify";
import {
  type XlsxResult,
  renderDocx,
  renderXlsx,
  PdfPreviewContent,
  VideoPreviewContent,
  AudioPreviewContent,
  ArchivePreviewContent,
  DesignPreviewContent,
  CsvPreviewContent,
  XlsxPreviewContent,
  BinaryInfo,
  MarkdownPreviewContent,
} from "./preview-renderers";

/* ===== Helpers ===== */

function highlightCode(code: string, language: string | null): string {
  const lang = language && hljs.getLanguage(language) ? language : "plaintext";
  return hljs.highlight(code, { language: lang }).value;
}

const CLAMP_ZOOM = (v: number) => Math.round(Math.max(0.25, Math.min(5, v)) * 100) / 100;

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

  // File tree sidebar
  const [showFileTree, setShowFileTree] = useState(() => {
    try { return localStorage.getItem("preview-filetree") === "1"; } catch { return false; }
  });
  const fileTreeRoot = useMemo(() => {
    if (!filePath) return null;
    const idx = filePath.lastIndexOf("/");
    return idx > 0 ? filePath.substring(0, idx) : null;
  }, [filePath]);

  const toggleFileTree = useCallback(() => {
    setShowFileTree((v) => {
      const next = !v;
      try { localStorage.setItem("preview-filetree", next ? "1" : "0"); } catch {}
      return next;
    });
  }, []);

  const handleFileTreeSelect = useCallback((path: string) => {
    window.dispatchEvent(new CustomEvent("preview-file", { detail: { path } }));
  }, []);

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
      const maxWidth = Math.floor(window.innerWidth * 0.6);
      setDrawerWidth(Math.max(300, Math.min(maxWidth, newWidth)));
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
      className={`preview-drawer${filePath ? " open" : ""}${showFileTree && fileTreeRoot ? " with-filetree" : ""}`}
      style={filePath ? { width: drawerWidth, minWidth: drawerWidth } : undefined}
    >
      <div className="preview-resize-handle" onMouseDown={handleResizeStart} />
      {showFileTree && fileTreeRoot && (
        <FileTreeSidebar
          rootPath={fileTreeRoot}
          activePath={preview?.path || filePath}
          workspace={workspace}
          onSelect={handleFileTreeSelect}
        />
      )}
      <div className="preview-inner">
        <div className="preview-header">
          <div className="preview-nav">
            <button
              className={`preview-nav-btn${showFileTree ? " active" : ""}`}
              onClick={toggleFileTree}
              title={showFileTree ? "隐藏目录" : "显示目录"}
            >
              {showFileTree ? <PanelLeftClose size={14} /> : <PanelLeftOpen size={14} />}
            </button>
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
