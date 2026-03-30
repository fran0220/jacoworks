import { Download, LoaderCircle, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { getFileTypeLabel, normalizeFileArtifact } from "../lib/file-artifacts";
import { formatSize, triggerBrowserDownload } from "../lib/file-utils";
import type { FileArtifact } from "../types";
import {
  ArchivePreviewContent,
  AudioPreviewContent,
  BinaryInfo,
  CodePreviewContent,
  CsvPreviewContent,
  DesignPreviewContent,
  type PreviewMetadata,
  MarkdownPreviewContent,
  PdfPreviewContent,
  renderDocx,
  renderXlsx,
  VideoPreviewContent,
  XlsxPreviewContent,
  type XlsxResult,
} from "./preview-renderers";
import DOMPurify from "dompurify";

function asPreviewMetadata(value: unknown): PreviewMetadata | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const entries = Object.entries(record).filter(([, item]) => item === null || ["string", "number", "boolean"].includes(typeof item));
  return entries.length > 0 ? Object.fromEntries(entries) as PreviewMetadata : null;
}

export default function WebPreviewPane({ artifact, onClose }: { artifact: FileArtifact | null; onClose: () => void }) {
  const [docHtml, setDocHtml] = useState<string | null>(null);
  const [textContent, setTextContent] = useState<string | null>(null);
  const [xlsxData, setXlsxData] = useState<XlsxResult | null>(null);
  const [activeSheet, setActiveSheet] = useState("");
  const [archiveEntries, setArchiveEntries] = useState<string[]>([]);
  const [metadata, setMetadata] = useState<PreviewMetadata | null>(null);
  const [csvSort, setCsvSort] = useState<{ col: number; asc: boolean } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const normalizedArtifact = useMemo(() => (artifact ? normalizeFileArtifact(artifact) || artifact : null), [artifact]);

  useEffect(() => {
    setArchiveEntries([]);
    setMetadata(null);
    if (!normalizedArtifact || !["archive", "design"].includes(normalizedArtifact.category || "")) return;

    const controller = new AbortController();
    void fetch(`/api/files/${encodeURIComponent(normalizedArtifact.id)}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<unknown>;
      })
      .then((payload) => {
        if (!payload || typeof payload !== "object") return;
        const record = payload as Record<string, unknown>;
        if (Array.isArray(record.entries)) {
          setArchiveEntries(record.entries.filter((entry): entry is string => typeof entry === "string"));
        }
        setMetadata(asPreviewMetadata(record.metadata));
      })
      .catch((err) => {
        if (!controller.signal.aborted) {
          setError((current) => current || String(err));
        }
      });

    return () => controller.abort();
  }, [normalizedArtifact]);

  useEffect(() => {
    setDocHtml(null);
    setTextContent(null);
    setXlsxData(null);
    setActiveSheet("");
    setCsvSort(null);
    setError(null);

    if (!normalizedArtifact) {
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    const load = async () => {
      const category = normalizedArtifact.category || "binary";
      if (["image", "pdf", "video", "audio", "archive", "design", "binary"].includes(category)) {
        setLoading(false);
        return;
      }

      setLoading(true);
      try {
        const response = await fetch(normalizedArtifact.contentUrl, { signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        if (category === "docx") {
          const html = await renderDocx(await response.arrayBuffer());
          if (!controller.signal.aborted) setDocHtml(html);
          return;
        }

        if (category === "xlsx") {
          const result = await renderXlsx(await response.arrayBuffer());
          if (!controller.signal.aborted) {
            setXlsxData(result);
            setActiveSheet(result.sheetNames[0] || "");
          }
          return;
        }

        const text = await response.text();
        if (!controller.signal.aborted) setTextContent(text);
      } catch (err) {
        if (!controller.signal.aborted) setError(String(err));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };

    void load();
    return () => controller.abort();
  }, [normalizedArtifact]);

  const renderContent = () => {
    if (!normalizedArtifact) {
      return <div className="preview-empty">选择文件以预览</div>;
    }
    if (error) {
      return <div className="preview-error">{error}</div>;
    }
    if (loading) {
      return (
        <div className="preview-loading">
          <LoaderCircle size={18} className="spinning" />
          <span>加载预览中...</span>
        </div>
      );
    }

    switch (normalizedArtifact.category) {
      case "image":
        return (
          <div className="preview-image-stage">
            <img className="preview-image-full" src={normalizedArtifact.contentUrl} alt={normalizedArtifact.name} />
          </div>
        );
      case "pdf":
        return <PdfPreviewContent fileUrl={normalizedArtifact.contentUrl} />;
      case "video":
        return <VideoPreviewContent fileUrl={normalizedArtifact.contentUrl} />;
      case "audio":
        return <AudioPreviewContent fileUrl={normalizedArtifact.contentUrl} />;
      case "docx":
        return docHtml ? <div className="preview-doc" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(docHtml) }} /> : <BinaryInfo artifact={normalizedArtifact} />;
      case "xlsx":
        return xlsxData ? <XlsxPreviewContent xlsxData={xlsxData} activeSheet={activeSheet} onSheetChange={setActiveSheet} /> : <BinaryInfo artifact={normalizedArtifact} />;
      case "csv":
        return textContent !== null ? <CsvPreviewContent content={textContent} sort={csvSort} onSort={setCsvSort} /> : <BinaryInfo artifact={normalizedArtifact} />;
      case "markdown":
        return textContent !== null ? <MarkdownPreviewContent content={textContent} /> : <BinaryInfo artifact={normalizedArtifact} />;
      case "code":
        return textContent !== null ? <CodePreviewContent content={textContent} language={normalizedArtifact.ext?.replace(/^\./, "").toLowerCase() || null} /> : <BinaryInfo artifact={normalizedArtifact} />;
      case "text":
        return textContent !== null ? <pre className="preview-text">{textContent}</pre> : <BinaryInfo artifact={normalizedArtifact} />;
      case "archive":
        return archiveEntries.length > 0 ? <ArchivePreviewContent entries={archiveEntries} metadata={metadata} /> : <BinaryInfo artifact={normalizedArtifact} />;
      case "design":
        return <DesignPreviewContent artifact={normalizedArtifact} metadata={metadata} />;
      default:
        return <BinaryInfo artifact={normalizedArtifact} />;
    }
  };

  return (
    <div className="web-preview-pane">
      <div className="web-preview-head">
        <div className="web-preview-title">
          <p className="thread-panel-eyebrow">Preview</p>
          <strong>{normalizedArtifact?.name || "文件预览"}</strong>
          {normalizedArtifact && (
            <span>{getFileTypeLabel(normalizedArtifact)} · {formatSize(normalizedArtifact.size)}</span>
          )}
        </div>

        <div className="web-preview-actions">
          {normalizedArtifact && (
            <button className="thread-panel-action" onClick={() => triggerBrowserDownload(normalizedArtifact.downloadUrl, normalizedArtifact.name)} title="下载文件">
              <Download size={15} />
            </button>
          )}
          <button className="thread-panel-action" onClick={onClose} title="关闭预览">
            <X size={15} />
          </button>
        </div>
      </div>

      <div className="web-preview-body">{renderContent()}</div>
    </div>
  );
}
