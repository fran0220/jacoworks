import DOMPurify from "dompurify";
import hljs from "highlight.js";
import "highlight.js/styles/github-dark.css";
import { marked } from "marked";
import { useMemo } from "react";
import type { MouseEventHandler } from "react";

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

marked.use({ renderer });

export default function Markdown({ content }: { content: string }) {
  const html = useMemo(
    () =>
      DOMPurify.sanitize(marked.parse(content) as string, {
        ADD_TAGS: ["pre", "code", "img"],
        ADD_ATTR: ["class", "id", "data-code-id", "src", "alt", "width", "height", "loading"],
      }),
    [content],
  );

  const onClick: MouseEventHandler<HTMLDivElement> = (event) => {
    const target = event.target as HTMLElement;
    if (!target.classList.contains("copy-btn")) return;

    const codeId = target.getAttribute("data-code-id");
    if (!codeId) return;

    const codeNode = document.getElementById(codeId);
    if (!codeNode?.textContent) return;

    navigator.clipboard.writeText(codeNode.textContent).catch(() => {});
    target.textContent = "已复制";
    setTimeout(() => {
      target.textContent = "复制";
    }, 1500);
  };

  return <div className="markdown-body" onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />;
}
