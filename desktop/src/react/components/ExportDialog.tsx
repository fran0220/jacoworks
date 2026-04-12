import { invoke } from "@tauri-apps/api/core";
import { desktopDir } from "@tauri-apps/api/path";
import { save } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useRef, useState } from "react";
import { FolderOpen, X } from "lucide-react";

type ExportFormat = "png" | "jpg";
type ExportScale = 1 | 2 | 3;

interface ExportDialogProps {
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
  defaultTitle: string;
  onClose: () => void;
}

const FORMAT_OPTIONS: { value: ExportFormat; label: string }[] = [
  { value: "png", label: "PNG" },
  { value: "jpg", label: "JPG" },
];

const SCALE_OPTIONS: ExportScale[] = [1, 2, 3];

export default function ExportDialog({ iframeRef, defaultTitle, onClose }: ExportDialogProps) {
  const [format, setFormat] = useState<ExportFormat>("png");
  const [scale, setScale] = useState<ExportScale>(2);
  const [savePath, setSavePath] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);
  const [exporting, setExporting] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Build default save path on mount
  useEffect(() => {
    const name = `${defaultTitle || "visual"}.${format}`;
    setSavePath((prev) => {
      if (prev) return prev.replace(/\.[^.]+$/, `.${format}`);
      return ""; // will be set by desktopDir below
    });
  }, [defaultTitle, format]);

  // Resolve actual desktop directory once on mount
  useEffect(() => {
    const name = `${defaultTitle || "visual"}.${format}`;
    desktopDir()
      .then((dir) => setSavePath((prev) => prev || `${dir}/${name}`))
      .catch(() => {/* keep empty — user must pick via dialog */});
  }, []);

  // Generate preview
  const renderPreview = useCallback(async () => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    setRendering(true);
    try {
      const doc = iframe.contentDocument;
      if (!doc) return;
      const { default: html2canvas } = await import("html2canvas");
      const canvas = await html2canvas(doc.documentElement, {
        backgroundColor: "#FAF7F4",
        scale,
        useCORS: true,
      });
      const mime = format === "jpg" ? "image/jpeg" : "image/png";
      const quality = format === "jpg" ? 0.92 : undefined;
      setPreview(canvas.toDataURL(mime, quality));
    } catch (err) {
      console.error("[ExportDialog] render failed:", err);
    } finally {
      setRendering(false);
    }
  }, [iframeRef, scale, format]);

  // Render on open and when scale/format changes
  useEffect(() => {
    renderPreview();
  }, [renderPreview]);

  // Escape to close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const handlePickPath = useCallback(async () => {
    const ext = format === "jpg" ? "jpg" : "png";
    const name = `${defaultTitle || "visual"}.${ext}`;
    const result = await save({
      defaultPath: name,
      filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
    });
    if (result) setSavePath(result);
  }, [format, defaultTitle]);

  const handleExport = useCallback(async () => {
    if (!preview || !savePath || exporting) return;
    setExporting(true);
    try {
      await invoke("write_file_base64", {
        path: savePath,
        data: preview,
        workspace: null,
      });
      onClose();
    } catch (err) {
      console.error("[ExportDialog] export failed:", err);
    } finally {
      setExporting(false);
    }
  }, [preview, savePath, exporting, onClose]);

  return (
    <div className="export-backdrop" onClick={onClose}>
      <div
        ref={dialogRef}
        className="export-dialog"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="export-header">
          <h3 className="export-title">导出为图片</h3>
          <button className="export-close" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        {/* Preview */}
        <div className="export-preview">
          {rendering && !preview && (
            <div className="export-preview-loading">渲染中…</div>
          )}
          {preview && (
            <img
              className="export-preview-img"
              src={preview}
              alt="Export preview"
              draggable={false}
            />
          )}
        </div>

        {/* Options */}
        <div className="export-options">
          {/* Format */}
          <div className="export-row">
            <label className="export-label">格式</label>
            <div className="export-segmented">
              {FORMAT_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  className={`export-seg-btn${format === opt.value ? " active" : ""}`}
                  onClick={() => setFormat(opt.value)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Scale */}
          <div className="export-row">
            <label className="export-label">倍率</label>
            <div className="export-segmented">
              {SCALE_OPTIONS.map((s) => (
                <button
                  key={s}
                  className={`export-seg-btn${scale === s ? " active" : ""}`}
                  onClick={() => setScale(s)}
                >
                  {s}x
                </button>
              ))}
            </div>
          </div>

          {/* Path */}
          <div className="export-row">
            <label className="export-label">保存到</label>
            <div className="export-path-group">
              <input
                className="export-path-input"
                value={savePath}
                onChange={(e) => setSavePath(e.target.value)}
                placeholder="选择保存路径"
                spellCheck={false}
              />
              <button className="export-path-btn" onClick={handlePickPath} title="选择路径">
                <FolderOpen size={14} />
              </button>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="export-actions">
          <button className="export-btn export-btn-cancel" onClick={onClose}>
            取消
          </button>
          <button
            className="export-btn export-btn-confirm"
            onClick={handleExport}
            disabled={!preview || !savePath || exporting}
          >
            {exporting ? "导出中…" : "导出"}
          </button>
        </div>
      </div>
    </div>
  );
}
