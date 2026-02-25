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
import { useMemo } from "react";
import type { MouseEventHandler } from "react";
import { invoke } from "@tauri-apps/api/core";

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

const FILE_EXT_MAP: Record<string, string> = {
  pdf: "Document · PDF",
  docx: "Document · DOCX",
  doc: "Document · DOC",
  xlsx: "Spreadsheet · XLSX",
  xls: "Spreadsheet · XLS",
  pptx: "Presentation · PPTX",
  txt: "Text · TXT",
  md: "Document · Markdown",
  mjs: "Script · MJS",
  js: "Script · JavaScript",
  ts: "Script · TypeScript",
  tsx: "Script · TSX",
  jsx: "Script · JSX",
  py: "Script · Python",
  go: "Source · Go",
  rs: "Source · Rust",
  json: "Data · JSON",
  yaml: "Config · YAML",
  yml: "Config · YAML",
  toml: "Config · TOML",
  html: "Web · HTML",
  css: "Style · CSS",
  sql: "Query · SQL",
  csv: "Data · CSV",
  png: "Image · PNG",
  jpg: "Image · JPEG",
  jpeg: "Image · JPEG",
  gif: "Image · GIF",
  svg: "Image · SVG",
  zip: "Archive · ZIP",
  tar: "Archive · TAR",
  gz: "Archive · GZ",
  sh: "Script · Shell",
  log: "Log · LOG",
  xml: "Data · XML",
};

function getFileInfo(text: string): { name: string; ext: string; typeLabel: string } | null {
  if (!text.includes(".")) return null;
  const ext = text.split(".").pop()?.toLowerCase();
  if (!ext || !FILE_EXT_MAP[ext]) return null;
  if (!text.includes("/") && !text.includes("\\")) return null;
  const name = text.split("/").pop() || text.split("\\").pop() || text;
  return { name, ext: ext.toUpperCase(), typeLabel: FILE_EXT_MAP[ext] };
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
  return `<div class="file-card" data-file-path="${escaped}">
    <div class="file-card-icon" data-ext="${fileInfo.ext}"></div>
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
  const html = useMemo(
    () =>
      DOMPurify.sanitize(marked.parse(content) as string, {
        ADD_TAGS: ["pre", "code", "img"],
        ADD_ATTR: [
          "class", "id", "data-code-id", "data-file-path", "data-ext",
          "src", "alt", "width", "height", "loading", "title",
        ],
      }),
    [content],
  );

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

  return <div className="markdown-body" onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />;
}
