import DOMPurify from "dompurify";
import hljs from "../lib/hljs-setup";
import { marked } from "marked";
import { useMemo, useRef } from "react";
import type { MouseEventHandler } from "react";

/* ---- File path detection ---- */

const FILE_SUFFIX_MAP: Array<{ suffix: string; ext: string; typeLabel: string; kind: string }> = [
  { suffix: ".tar.gz", ext: "TAR.GZ", typeLabel: "Archive · TAR.GZ", kind: "archive" },
  { suffix: ".tgz", ext: "TGZ", typeLabel: "Archive · TGZ", kind: "archive" },
];

const FILE_EXT_MAP: Record<string, { typeLabel: string; kind: string }> = {
  pdf: { typeLabel: "Document · PDF", kind: "pdf" },
  docx: { typeLabel: "Document · DOCX", kind: "document" },
  doc: { typeLabel: "Document · DOC", kind: "document" },
  xlsx: { typeLabel: "Spreadsheet · XLSX", kind: "document" },
  xls: { typeLabel: "Spreadsheet · XLS", kind: "document" },
  pptx: { typeLabel: "Presentation · PPTX", kind: "document" },
  txt: { typeLabel: "Text · TXT", kind: "text" },
  md: { typeLabel: "Document · Markdown", kind: "text" },
  mjs: { typeLabel: "Script · MJS", kind: "code" },
  js: { typeLabel: "Script · JavaScript", kind: "code" },
  ts: { typeLabel: "Script · TypeScript", kind: "code" },
  tsx: { typeLabel: "Script · TSX", kind: "code" },
  jsx: { typeLabel: "Script · JSX", kind: "code" },
  py: { typeLabel: "Script · Python", kind: "code" },
  go: { typeLabel: "Source · Go", kind: "code" },
  rs: { typeLabel: "Source · Rust", kind: "code" },
  json: { typeLabel: "Data · JSON", kind: "code" },
  yaml: { typeLabel: "Config · YAML", kind: "code" },
  yml: { typeLabel: "Config · YAML", kind: "code" },
  toml: { typeLabel: "Config · TOML", kind: "code" },
  html: { typeLabel: "Web · HTML", kind: "code" },
  css: { typeLabel: "Style · CSS", kind: "code" },
  sql: { typeLabel: "Query · SQL", kind: "code" },
  csv: { typeLabel: "Data · CSV", kind: "csv" },
  png: { typeLabel: "Image · PNG", kind: "image" },
  jpg: { typeLabel: "Image · JPEG", kind: "image" },
  jpeg: { typeLabel: "Image · JPEG", kind: "image" },
  gif: { typeLabel: "Image · GIF", kind: "image" },
  svg: { typeLabel: "Image · SVG", kind: "image" },
  webp: { typeLabel: "Image · WEBP", kind: "image" },
  bmp: { typeLabel: "Image · BMP", kind: "image" },
  mp4: { typeLabel: "Video · MP4", kind: "video" },
  mov: { typeLabel: "Video · MOV", kind: "video" },
  m4v: { typeLabel: "Video · M4V", kind: "video" },
  webm: { typeLabel: "Video · WEBM", kind: "video" },
  mp3: { typeLabel: "Audio · MP3", kind: "audio" },
  wav: { typeLabel: "Audio · WAV", kind: "audio" },
  m4a: { typeLabel: "Audio · M4A", kind: "audio" },
  aac: { typeLabel: "Audio · AAC", kind: "audio" },
  ogg: { typeLabel: "Audio · OGG", kind: "audio" },
  flac: { typeLabel: "Audio · FLAC", kind: "audio" },
  zip: { typeLabel: "Archive · ZIP", kind: "archive" },
  tar: { typeLabel: "Archive · TAR", kind: "archive" },
  fig: { typeLabel: "Design · FIG", kind: "design" },
  sketch: { typeLabel: "Design · SKETCH", kind: "design" },
  psd: { typeLabel: "Design · PSD", kind: "design" },
  sh: { typeLabel: "Script · Shell", kind: "code" },
  log: { typeLabel: "Log · LOG", kind: "code" },
  xml: { typeLabel: "Data · XML", kind: "code" },
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

/* ---- Marked renderer ---- */

marked.setOptions({ gfm: true, breaks: true });

const renderer = new marked.Renderer();

renderer.code = ({ text, lang }) => {
  const language = lang && hljs.getLanguage(lang) ? lang : "plaintext";
  const highlighted = hljs.highlight(text, { language }).value;
  const id = `code-${Math.random().toString(36).slice(2, 9)}`;
  return `<div class="code-block">
    <div class="code-header">
      <span class="code-lang">${language}</span>
      <button class="copy-btn" data-code-id="${id}">复制</button>
    </div>
    <pre><code id="${id}" class="hljs language-${language}">${highlighted}</code></pre>
  </div>`;
};

renderer.image = ({ href, title, text }) => {
  if (!href) return `<img alt="${(text || "").replace(/"/g, "&quot;")}" />`;

  const safeAlt = (text || "").replace(/"/g, "&quot;");
  const safeTitle = title ? ` title="${title.replace(/"/g, "&quot;")}"` : "";

  // Web version: only render remote/data URLs (no local file resolution)
  if (/^(https?:|data:)/i.test(href)) {
    return `<img src="${href.replace(/"/g, "&quot;")}" alt="${safeAlt}"${safeTitle} loading="lazy" class="md-image" />`;
  }

  // Local paths cannot be resolved in web context
  return `<span class="md-image-placeholder" title="${href.replace(/"/g, "&quot;")}">[图片: ${safeAlt || href}]</span>`;
};

renderer.codespan = ({ text }) => {
  const decoded = text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"');
  const fileInfo = getFileInfo(decoded);
  if (!fileInfo) {
    return `<code>${text}</code>`;
  }
  const escaped = decoded.replace(/"/g, "&quot;");
  return `<code class="file-ref" data-file-path="${escaped}" title="${fileInfo.typeLabel}">${text}</code>`;
};

marked.use({ renderer });

export default function Markdown({ content }: { content: string }) {
  const rootRef = useRef<HTMLDivElement>(null);

  const html = useMemo(
    () =>
      DOMPurify.sanitize(marked.parse(content) as string, {
        ADD_TAGS: ["pre", "code", "img"],
        ADD_ATTR: [
          "class", "id", "data-code-id", "data-file-path", "data-ext", "data-kind",
          "src", "alt", "width", "height", "loading", "title", "decoding",
        ],
      }),
    [content],
  );

  const onClick: MouseEventHandler<HTMLDivElement> = (event) => {
    const target = event.target as HTMLElement;

    // Copy code button
    if (target.classList.contains("copy-btn")) {
      const codeId = target.getAttribute("data-code-id");
      if (!codeId) return;
      const codeNode = document.getElementById(codeId);
      if (!codeNode?.textContent) return;
      navigator.clipboard.writeText(codeNode.textContent).catch(() => {});
      target.textContent = "已复制";
      setTimeout(() => {
        target.textContent = "复制";
      }, 1500);
      return;
    }
  };

  return <div ref={rootRef} className="markdown-body" onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />;
}
