import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import rehypeHighlight from "rehype-highlight";
import { useCallback, useEffect, useRef, useState } from "react";
import type { MouseEventHandler, ComponentPropsWithoutRef } from "react";
import { invoke } from "@tauri-apps/api/core";

/* ---- File path detection ---- */

const FILE_SUFFIX_MAP: Array<{ suffix: string; ext: string; typeLabel: string; kind: string }> = [
  { suffix: ".tar.gz", ext: "TAR.GZ", typeLabel: "Archive \u00b7 TAR.GZ", kind: "archive" },
  { suffix: ".tgz", ext: "TGZ", typeLabel: "Archive \u00b7 TGZ", kind: "archive" },
];

const FILE_EXT_MAP: Record<string, { typeLabel: string; kind: string }> = {
  pdf: { typeLabel: "Document \u00b7 PDF", kind: "pdf" },
  docx: { typeLabel: "Document \u00b7 DOCX", kind: "document" },
  doc: { typeLabel: "Document \u00b7 DOC", kind: "document" },
  xlsx: { typeLabel: "Spreadsheet \u00b7 XLSX", kind: "document" },
  xls: { typeLabel: "Spreadsheet \u00b7 XLS", kind: "document" },
  pptx: { typeLabel: "Presentation \u00b7 PPTX", kind: "document" },
  txt: { typeLabel: "Text \u00b7 TXT", kind: "text" },
  md: { typeLabel: "Document \u00b7 Markdown", kind: "text" },
  mjs: { typeLabel: "Script \u00b7 MJS", kind: "code" },
  js: { typeLabel: "Script \u00b7 JavaScript", kind: "code" },
  ts: { typeLabel: "Script \u00b7 TypeScript", kind: "code" },
  tsx: { typeLabel: "Script \u00b7 TSX", kind: "code" },
  jsx: { typeLabel: "Script \u00b7 JSX", kind: "code" },
  py: { typeLabel: "Script \u00b7 Python", kind: "code" },
  go: { typeLabel: "Source \u00b7 Go", kind: "code" },
  rs: { typeLabel: "Source \u00b7 Rust", kind: "code" },
  json: { typeLabel: "Data \u00b7 JSON", kind: "code" },
  yaml: { typeLabel: "Config \u00b7 YAML", kind: "code" },
  yml: { typeLabel: "Config \u00b7 YAML", kind: "code" },
  toml: { typeLabel: "Config \u00b7 TOML", kind: "code" },
  html: { typeLabel: "Web \u00b7 HTML", kind: "code" },
  css: { typeLabel: "Style \u00b7 CSS", kind: "code" },
  sql: { typeLabel: "Query \u00b7 SQL", kind: "code" },
  csv: { typeLabel: "Data \u00b7 CSV", kind: "csv" },
  png: { typeLabel: "Image \u00b7 PNG", kind: "image" },
  jpg: { typeLabel: "Image \u00b7 JPEG", kind: "image" },
  jpeg: { typeLabel: "Image \u00b7 JPEG", kind: "image" },
  gif: { typeLabel: "Image \u00b7 GIF", kind: "image" },
  svg: { typeLabel: "Image \u00b7 SVG", kind: "image" },
  webp: { typeLabel: "Image \u00b7 WEBP", kind: "image" },
  bmp: { typeLabel: "Image \u00b7 BMP", kind: "image" },
  mp4: { typeLabel: "Video \u00b7 MP4", kind: "video" },
  mov: { typeLabel: "Video \u00b7 MOV", kind: "video" },
  m4v: { typeLabel: "Video \u00b7 M4V", kind: "video" },
  webm: { typeLabel: "Video \u00b7 WEBM", kind: "video" },
  mp3: { typeLabel: "Audio \u00b7 MP3", kind: "audio" },
  wav: { typeLabel: "Audio \u00b7 WAV", kind: "audio" },
  m4a: { typeLabel: "Audio \u00b7 M4A", kind: "audio" },
  aac: { typeLabel: "Audio \u00b7 AAC", kind: "audio" },
  ogg: { typeLabel: "Audio \u00b7 OGG", kind: "audio" },
  flac: { typeLabel: "Audio \u00b7 FLAC", kind: "audio" },
  zip: { typeLabel: "Archive \u00b7 ZIP", kind: "archive" },
  tar: { typeLabel: "Archive \u00b7 TAR", kind: "archive" },
  fig: { typeLabel: "Design \u00b7 FIG", kind: "design" },
  sketch: { typeLabel: "Design \u00b7 SKETCH", kind: "design" },
  psd: { typeLabel: "Design \u00b7 PSD", kind: "design" },
  sh: { typeLabel: "Script \u00b7 Shell", kind: "code" },
  log: { typeLabel: "Log \u00b7 LOG", kind: "code" },
  xml: { typeLabel: "Data \u00b7 XML", kind: "code" },
};

function getFileInfo(text: string): { name: string; ext: string; typeLabel: string; kind: string } | null {
  if (!text.includes(".")) return null;
  const hasPath = text.includes("/") || text.includes("\\");
  const name = hasPath ? (text.split(/[\\/]/).pop() || text) : text;
  const lowerName = name.toLowerCase();

  for (const item of FILE_SUFFIX_MAP) {
    if (lowerName.endsWith(item.suffix)) {
      return { name, ext: item.ext, typeLabel: item.typeLabel, kind: item.kind };
    }
  }

  const ext = name.split(".").pop()?.toLowerCase();
  if (!ext || !FILE_EXT_MAP[ext]) return null;
  return { name, ext: ext.toUpperCase(), typeLabel: FILE_EXT_MAP[ext].typeLabel, kind: FILE_EXT_MAP[ext].kind };
}

/* ---- Custom components for ReactMarkdown ---- */

function CodeBlock({
  children,
  className,
}: ComponentPropsWithoutRef<"code"> & { inline?: boolean }) {
  const isInline = !className;

  if (isInline) {
    // Check if this is a file reference
    const text = typeof children === "string" ? children : String(children ?? "");
    const fileInfo = getFileInfo(text);
    if (fileInfo) {
      return (
        <code
          className="file-ref"
          data-file-path={text}
          title={fileInfo.typeLabel}
        >
          {children}
        </code>
      );
    }
    return <code>{children}</code>;
  }

  // Block code — rehype-highlight already applied hljs classes
  const lang = className?.replace("language-", "") || "plaintext";

  const handleCopy = () => {
    const text = typeof children === "string" ? children : String(children ?? "");
    navigator.clipboard.writeText(text).catch(() => {});
  };

  return (
    <div className="code-block">
      <div className="code-header">
        <span className="code-lang">{lang}</span>
        <CopyButton onCopy={handleCopy} />
      </div>
      <pre>
        <code className={className}>{children}</code>
      </pre>
    </div>
  );
}

function CopyButton({ onCopy }: { onCopy: () => void }) {
  const [copied, setCopied] = useState(false);

  const handleClick = () => {
    onCopy();
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <button className="copy-btn" onClick={handleClick} type="button">
      {copied ? "\u5df2\u590d\u5236" : "\u590d\u5236"}
    </button>
  );
}

function LocalImage({
  src,
  alt,
  title,
  workspacePath,
}: {
  src?: string;
  alt?: string;
  title?: string;
  workspacePath?: string;
}) {
  const [resolvedSrc, setResolvedSrc] = useState<string | undefined>(undefined);
  const [error, setError] = useState(false);

  const isRemote = src && /^(https?:|data:)/i.test(src);
  const isLocal = src && !isRemote;

  useEffect(() => {
    if (!isLocal) return;
    let cancelled = false;

    invoke<string>("read_file_base64", {
      path: src,
      workspace: workspacePath || null,
    })
      .then((url) => {
        if (!cancelled) setResolvedSrc(url);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });

    return () => { cancelled = true; };
  }, [src, isLocal, workspacePath]);

  if (error) {
    return <span>[图片加载失败: {src}]</span>;
  }

  const finalSrc = isRemote ? src : resolvedSrc;
  const pending = isLocal && !resolvedSrc && !error;

  return (
    <img
      src={finalSrc}
      alt={alt || ""}
      title={title}
      loading="lazy"
      className={`md-image${pending ? " md-image-pending" : ""}`}
    />
  );
}

/* ---- Remark/rehype plugins (stable references) ---- */

const remarkPlugins = [remarkGfm, remarkBreaks];
const rehypePlugins = [rehypeHighlight];

/* ---- Main component ---- */

export default function Markdown({
  content,
  workspacePath,
}: {
  content: string;
  workspacePath?: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);

  // Build components object with workspace context
  const components = useCallback(() => ({
    code: CodeBlock,
    img: (props: ComponentPropsWithoutRef<"img">) => (
      <LocalImage {...props} workspacePath={workspacePath} />
    ),
    // Open external links in default browser
    a: ({ href, children, ...rest }: ComponentPropsWithoutRef<"a">) => (
      <a href={href} target="_blank" rel="noopener noreferrer" {...rest}>
        {children}
      </a>
    ),
    // Unwrap ReactMarkdown's default <pre> around code blocks — our CodeBlock handles it
    pre: ({ children }: ComponentPropsWithoutRef<"pre">) => <>{children}</>,
  }), [workspacePath]);

  const onClick: MouseEventHandler<HTMLDivElement> = (event) => {
    const target = event.target as HTMLElement;

    // File-ref click → trigger preview
    const fileRef = target.closest(".file-ref") as HTMLElement | null;
    if (fileRef) {
      const filePath = fileRef.getAttribute("data-file-path");
      if (filePath) {
        window.dispatchEvent(
          new CustomEvent("preview-file", { detail: { path: filePath } }),
        );
      }
    }
  };

  return (
    <div ref={rootRef} className="markdown-body" onClick={onClick}>
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        components={components()}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
