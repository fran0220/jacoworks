import { invoke } from "@tauri-apps/api/core";
import hljs from "highlight.js/lib/core";
import { X, ExternalLink, FolderOpen, LoaderCircle } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { FilePreview } from "../types";

// Lazy imports for heavy document processing libs
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

function highlightCode(code: string, language: string | null): string {
  const lang = language && hljs.getLanguage(language) ? language : "plaintext";
  return hljs.highlight(code, { language: lang }).value;
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
  const contentRef = useRef<HTMLDivElement>(null);

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
            setError(`DOCX 解析失败: ${err}`);
          }
        } else if (data.category === "xlsx" && data.content) {
          try {
            const html = await renderXlsx(data.content);
            setDocHtml(html);
          } catch (err) {
            setError(`Excel 解析失败: ${err}`);
          }
        }
      })
      .catch((err) => setError(String(err)))
      .finally(() => setLoading(false));
  }, [filePath, workspace]);

  // ESC to close
  useEffect(() => {
    if (!filePath) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
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

  // Determine what to render in content area
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
      case "image":
        return preview.content ? (
          <div className="preview-image-wrap">
            <img
              className={`preview-image${imageZoomed ? " zoomed" : ""}`}
              src={preview.content}
              alt={preview.name}
              onClick={() => setImageZoomed((z) => !z)}
            />
          </div>
        ) : (
          <div className="preview-error">图片过大，无法预览</div>
        );

      case "code":
        if (!preview.content) return <div className="preview-error">无法读取文件</div>;
        return (
          <div className="preview-code-wrap">
            <pre className="preview-code">
              <code
                dangerouslySetInnerHTML={{
                  __html: preview.content
                    .split("\n")
                    .map((line, i) => {
                      const highlighted = highlightCode(line, preview.language);
                      return `<span class="code-line"><span class="line-number">${i + 1}</span><span class="line-content">${highlighted}</span></span>`;
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
        <div className="preview-content" ref={contentRef}>
          {renderContent()}
        </div>
      </div>
    </div>
  );
}

// Sub-components

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
