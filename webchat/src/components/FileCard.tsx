import {
  Download,
  FileArchive,
  FileCode2,
  FileImage,
  FileSpreadsheet,
  FileText,
  Image,
  Music4,
  PlaySquare,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { getFileTypeLabel } from "../lib/file-artifacts";
import { formatSize, triggerBrowserDownload } from "../lib/file-utils";
import type { FileArtifact } from "../types";

function iconForArtifact(artifact: FileArtifact): LucideIcon {
  switch (artifact.category) {
    case "image":
      return Image;
    case "pdf":
    case "docx":
    case "markdown":
    case "text":
    case "design":
      return FileText;
    case "xlsx":
    case "csv":
      return FileSpreadsheet;
    case "code":
      return FileCode2;
    case "archive":
      return FileArchive;
    case "audio":
      return Music4;
    case "video":
      return PlaySquare;
    default:
      return FileImage;
  }
}

export default function FileCard({
  artifact,
  onPreview,
}: {
  artifact: FileArtifact;
  onPreview: (artifact: FileArtifact) => void;
}) {
  const Icon = iconForArtifact(artifact);
  const showThumb = artifact.category === "image";

  return (
    <div className="file-card">
      {showThumb && (
        <button className="file-card-thumb-button" onClick={() => onPreview(artifact)} title="预览图片">
          <img className="file-card-thumb" src={artifact.contentUrl} alt={artifact.name} loading="lazy" />
        </button>
      )}

      <div className="file-card-row">
        <button className="file-card-main" onClick={() => onPreview(artifact)} title="打开预览">
          <span className="file-card-icon-wrap">
            <Icon size={16} className="file-card-icon" />
          </span>
          <span className="file-card-copy">
            <strong>{artifact.name}</strong>
            <span>{getFileTypeLabel(artifact)} · {formatSize(artifact.size)}</span>
            {artifact.pathLabel && <small>{artifact.pathLabel}</small>}
          </span>
        </button>

        <div className="file-card-actions">
          <button className="file-card-action" onClick={() => onPreview(artifact)} title="预览文件">
            预览
          </button>
          <button
            className="file-card-action"
            onClick={() => triggerBrowserDownload(artifact.downloadUrl, artifact.name)}
            title="下载文件"
          >
            <Download size={13} />
            <span>下载</span>
          </button>
        </div>
      </div>
    </div>
  );
}
