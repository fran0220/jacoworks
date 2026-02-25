import DOMPurify from "dompurify";
import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import go from "highlight.js/lib/languages/go";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import plaintext from "highlight.js/lib/languages/plaintext";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import "highlight.js/styles/github-dark.css";
import { marked } from "marked";
import { useEffect, useMemo, useRef } from "react";
import type { MouseEventHandler } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";

hljs.registerLanguage("bash", bash);
hljs.registerLanguage("css", css);
hljs.registerLanguage("go", go);
hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("json", json);
hljs.registerLanguage("plaintext", plaintext);
hljs.registerLanguage("python", python);
hljs.registerLanguage("rust", rust);
hljs.registerLanguage("sql", sql);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("yaml", yaml);

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
  csv: { typeLabel: "Data · CSV", kind: "code" },
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
  if (!text.includes("/") && !text.includes("\\")) return null;
  const name = text.split("/").pop() || text.split("\\").pop() || text;
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
  const escapedName = fileInfo.name.replace(/"/g, "&quot;");
  const iconInner = fileInfo.kind === "image"
    ? `<img class="file-card-thumb" data-file-path="${escaped}" alt="${escapedName}" loading="lazy" decoding="async" />`
    : "";

  return `<div class="file-card${fileInfo.kind === "image" ? " has-thumb" : ""}" data-file-path="${escaped}" data-kind="${fileInfo.kind}">
    <div class="file-card-icon${fileInfo.kind === "image" ? " image-icon" : ""}" data-ext="${fileInfo.ext}">
      ${iconInner}
    </div>
    <div class="file-card-info">
      <span class="file-card-name">${fileInfo.name}</span>
      <span class="file-card-type">${fileInfo.typeLabel}</span>
    </div>
    <div class="file-card-actions">
      <button class="file-card-btn preview-btn" data-file-path="${escaped}">预览</button>
      <button class="file-card-btn reveal-btn" data-file-path="${escaped}">目录</button>
      <button class="file-card-btn open-file-btn" data-file-path="${escaped}">打开</button>
    </div>
  </div>`;
};

marked.use({ renderer });

async function openFileDefault(path: string, workspace?: string) {
  console.log("[file-card] openFileDefault →", { path, workspace });
  try {
    await invoke("open_file_default", { path, workspace: workspace || null });
  } catch (err) {
    console.error("[file-card] open failed:", err);
  }
}

async function revealInFinder(path: string, workspace?: string) {
  console.log("[file-card] revealInFinder →", { path, workspace });
  try {
    await invoke("reveal_in_finder", { path, workspace: workspace || null });
  } catch (err) {
    console.error("[file-card] reveal failed:", err);
  }
}

export default function Markdown({
  content,
  workspacePath,
}: {
  content: string;
  workspacePath?: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const thumbUrlCacheRef = useRef<Map<string, string>>(new Map());

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

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const thumbs = Array.from(
      root.querySelectorAll<HTMLImageElement>(".file-card-thumb[data-file-path]"),
    );
    if (!thumbs.length) return;

    let disposed = false;

    const loadThumb = async (node: HTMLImageElement) => {
      if (disposed || node.dataset.thumbLoaded === "1") return;

      const filePath = node.getAttribute("data-file-path");
      if (!filePath) return;

      node.dataset.thumbLoaded = "1";

      let assetUrl = thumbUrlCacheRef.current.get(filePath);
      if (!assetUrl) {
        try {
          const resolved = await invoke<string>("resolve_file_path", {
            path: filePath,
            workspace: workspacePath || null,
          });
          assetUrl = convertFileSrc(resolved);
          thumbUrlCacheRef.current.set(filePath, assetUrl);
        } catch {
          node.classList.add("thumb-failed");
          return;
        }
      }

      if (disposed) return;
      node.onload = () => node.classList.add("ready");
      node.onerror = () => node.classList.add("thumb-failed");
      node.src = assetUrl;
    };

    if ("IntersectionObserver" in window) {
      const observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            const node = entry.target as HTMLImageElement;
            observer.unobserve(node);
            void loadThumb(node);
          }
        },
        { rootMargin: "120px 0px" },
      );

      for (const thumb of thumbs) {
        observer.observe(thumb);
      }

      return () => {
        disposed = true;
        observer.disconnect();
      };
    }

    for (const thumb of thumbs) {
      void loadThumb(thumb);
    }

    return () => {
      disposed = true;
    };
  }, [html, workspacePath]);

  const onClick: MouseEventHandler<HTMLDivElement> = (event) => {
    const target = event.target as HTMLElement;
    console.log("[file-card] click →", target.tagName, target.className, target.getAttribute("data-file-path"));

    // Copy code button (existing)
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

    // File card: preview
    const previewBtn = target.closest(".preview-btn") as HTMLElement | null;
    if (previewBtn) {
      const filePath = previewBtn.getAttribute("data-file-path");
      if (filePath) {
        window.dispatchEvent(
          new CustomEvent("preview-file", { detail: { path: filePath } }),
        );
      }
      return;
    }

    // File card: reveal in folder
    const revealBtn = target.closest(".reveal-btn") as HTMLElement | null;
    if (revealBtn) {
      const filePath = revealBtn.getAttribute("data-file-path");
      if (filePath) revealInFinder(filePath, workspacePath);
      return;
    }

    // File card: open file
    const openBtn = target.closest(".open-file-btn") as HTMLElement | null;
    if (openBtn) {
      const filePath = openBtn.getAttribute("data-file-path");
      if (filePath) openFileDefault(filePath, workspacePath);
      return;
    }
  };

  return <div ref={rootRef} className="markdown-body" onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />;
}
