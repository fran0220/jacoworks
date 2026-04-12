import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import { Download } from "lucide-react";
import hljs from "../lib/hljs-setup";
import { toolArgsSummary } from "../lib/tool-utils";
import type { AssistantPart, AttachedFile } from "../types";
import ExportDialog from "./ExportDialog";
import ImageResultCard from "./ImageResultCard";
import Markdown from "./Markdown";
import ToolStatus from "./ToolStatus";

/* ---- Extension → highlight.js language map ---- */

const EXT_LANG_MAP: Record<string, string> = {
  ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
  mjs: "javascript", py: "python", go: "go", rs: "rust", sql: "sql",
  json: "json", yaml: "yaml", yml: "yaml", css: "css", html: "xml",
  xml: "xml", sh: "bash", bash: "bash", toml: "yaml", md: "plaintext",
  txt: "plaintext", log: "plaintext",
};

function langFromPath(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() || "";
  return EXT_LANG_MAP[ext] || "plaintext";
}

/* ---- Diff view for edit tool ---- */

function DiffView({ result }: { result: string }) {
  const lines = result.split("\n");
  return (
    <div className="tool-diff">
      {lines.map((line, i) => {
        let cls = "context";
        if (line.startsWith("@@")) cls = "hunk";
        else if (line.startsWith("+")) cls = "added";
        else if (line.startsWith("-")) cls = "removed";
        return (
          <span key={i} className={`tool-diff-line ${cls}`}>
            {line}
            {"\n"}
          </span>
        );
      })}
    </div>
  );
}

/* ---- Code view for read tool ---- */

function CodeView({ filePath, result }: { filePath: string; result: string }) {
  const [expanded, setExpanded] = useState(false);
  const lines = result.split("\n");
  const truncated = !expanded && lines.length > 50;
  const display = truncated ? lines.slice(0, 50).join("\n") : result;
  const lang = langFromPath(filePath);
  const highlighted = hljs.getLanguage(lang)
    ? hljs.highlight(display, { language: lang }).value
    : display;

  return (
    <div>
      <div className="tool-result-header">
        <span className="tool-result-path">{filePath}</span>
      </div>
      <pre className="tool-code-result">
        <code dangerouslySetInnerHTML={{ __html: highlighted }} />
      </pre>
      {truncated && (
        <button className="tool-show-more" onClick={() => setExpanded(true)}>
          显示全部 ({lines.length} 行)
        </button>
      )}
    </div>
  );
}

/* ---- Grep/Find results ---- */

function GrepView({ result }: { result: string }) {
  const lines = result.split("\n").filter(Boolean);
  return (
    <div className="tool-grep-result">
      {lines.map((line, i) => {
        const match = line.match(/^(.+?):(\d+):(.*)$/);
        if (match) {
          return (
            <div key={i} className="tool-grep-item">
              <span className="tool-grep-file" title={match[1]}>{match[1]}</span>
              <span className="tool-grep-line-num">{match[2]}</span>
              <span className="tool-grep-text">{match[3]}</span>
            </div>
          );
        }
        return (
          <div key={i} className="tool-grep-item">
            <span className="tool-grep-text">{line}</span>
          </div>
        );
      })}
    </div>
  );
}

/* ---- Bash terminal output ---- */

function BashView({ args, result }: { args?: string; result?: string }) {
  let command = "";
  if (args) {
    try { command = JSON.parse(args).command || ""; } catch { /* ignore */ }
  }
  return (
    <div className="tool-bash-result">
      {command && <div className="tool-bash-cmd">$ {command}</div>}
      {result && <div className="tool-bash-output">{result}</div>}
    </div>
  );
}

/* ---- Unified tool result view ---- */

function ToolResultView({ toolName, args, result }: { toolName: string; args?: string; result?: string }) {
  if (toolName === "edit" && result) {
    return (
      <>
        {args && <pre className="msg-tool-code">{args}</pre>}
        <DiffView result={result} />
      </>
    );
  }

  if (toolName === "read" && result) {
    let filePath = "";
    if (args) {
      try { filePath = JSON.parse(args).path || ""; } catch { /* ignore */ }
    }
    return filePath
      ? <CodeView filePath={filePath} result={result} />
      : <pre className="msg-tool-code">{result}</pre>;
  }

  if ((toolName === "grep" || toolName === "find") && result) {
    return (
      <>
        {args && <pre className="msg-tool-code">{args}</pre>}
        <GrepView result={result} />
      </>
    );
  }

  if (toolName === "bash") {
    return <BashView args={args} result={result} />;
  }

  return (
    <>
      {args && <pre className="msg-tool-code">{args}</pre>}
      {result && <pre className="msg-tool-code">{result}</pre>}
    </>
  );
}

/* ---- File card from tool result ---- */

function ToolFileCard({ filePath, fileKind, workspacePath }: { filePath: string; fileKind?: string; workspacePath?: string }) {
  const name = filePath.split(/[\\/]/).pop() || filePath;
  const ext = name.split(".").pop()?.toUpperCase() || "";
  const isImage = fileKind === "image";

  const [thumbSrc, setThumbSrc] = useState<string | null>(null);

  useEffect(() => {
    if (!isImage) return;
    let cancelled = false;
    invoke<string>("read_file_base64", { path: filePath, workspace: workspacePath || null })
      .then((url) => { if (!cancelled) setThumbSrc(url); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [filePath, isImage, workspacePath]);

  const handleTogglePreview = () => {
    window.dispatchEvent(new CustomEvent("preview-file", { detail: { path: filePath } }));
  };

  return (
    <div className={`tool-file-card${isImage ? " has-thumb" : ""}`} onClick={handleTogglePreview}>
      <div className={`tool-file-card-icon${isImage ? " image-icon" : ""}`}>
        {isImage && thumbSrc ? (
          <img className="tool-file-card-thumb" src={thumbSrc} alt={name} />
        ) : (
          <span className="tool-file-card-ext">{ext}</span>
        )}
      </div>
      <div className="tool-file-card-info">
        <span className="tool-file-card-name">{name}</span>
        <span className="tool-file-card-type">{fileKind === "image" ? `Image · ${ext}` : fileKind === "document" ? `Document · ${ext}` : `File · ${ext}`}</span>
      </div>
    </div>
  );
}

/* ---- Elapsed timer for running tools ---- */

function ToolElapsed() {
  const [startedAt] = useState(Date.now);
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(id);
  }, [startedAt]);
  if (elapsed < 3) return null;
  return <span className="process-strip-elapsed">{elapsed}s</span>;
}

/* ---- Inline visual widget from render_visual tool ---- */

const VISUAL_BASE_CSS = `
<style>
  *, *::before, *::after { box-sizing: border-box; }
  html, body { height: auto; overflow: visible; }
  body {
    margin: 0; padding: 16px 20px;
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", sans-serif;
    font-size: 14px; line-height: 1.6;
    color: #1A1A1A; background: #FAF7F4;
  }
  h1, h2, h3, h4 { color: #1A1A1A; font-weight: 600; margin: 0 0 8px; }
  h1 { font-size: 20px; } h2 { font-size: 17px; } h3 { font-size: 15px; }
  p { margin: 0 0 8px; color: #5A5248; }
  table { border-collapse: collapse; width: 100%; }
  th, td { padding: 8px 12px; text-align: left; border-bottom: 1px solid #E0D8D0; }
  th { font-weight: 600; color: #5A5248; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; }
  td { color: #1A1A1A; }
  tr:hover td { background: rgba(196,114,74,0.04); }
  code { font-family: "Maple Mono", ui-monospace, monospace; font-size: 13px; background: #EDE8E3; padding: 2px 5px; border-radius: 4px; }
  canvas { max-width: 100%; }
</style>
`;

function injectVisualBaseStyles(html: string): string {
  if (html.includes("<head>")) {
    return html.replace("<head>", "<head>" + VISUAL_BASE_CSS);
  }
  if (html.includes("<html>")) {
    return html.replace("<html>", "<html><head>" + VISUAL_BASE_CSS + "</head>");
  }
  return VISUAL_BASE_CSS + html;
}

function resizeIframe(iframe: HTMLIFrameElement) {
  try {
    const doc = iframe.contentDocument;
    if (!doc) return;
    const h = doc.documentElement.scrollHeight;
    if (h > 0) iframe.style.height = `${h}px`;
  } catch { /* cross-origin fallback: keep min-height */ }
}

function VisualWidget({ data }: { data: string }) {
  let parsed: { type?: string; title?: string; html?: string };
  try { parsed = JSON.parse(data); } catch { return null; }
  if (!parsed.html) return null;

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [showExport, setShowExport] = useState(false);

  const handleLoad = () => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    resizeIframe(iframe);
    setTimeout(() => resizeIframe(iframe), 300);
    setTimeout(() => resizeIframe(iframe), 1000);
    try {
      const doc = iframe.contentDocument;
      if (doc) {
        new ResizeObserver(() => resizeIframe(iframe)).observe(doc.documentElement);
      }
    } catch { /* ignore */ }
  };

  return (
    <div className="visual-widget">
      <div className="visual-widget-header">
        {parsed.title && <div className="visual-widget-title">{parsed.title}</div>}
        <button
          className="visual-widget-export"
          onClick={() => setShowExport(true)}
          title="导出为图片"
        >
          <Download size={14} />
        </button>
      </div>
      <iframe
        ref={iframeRef}
        className="visual-widget-frame"
        sandbox="allow-scripts allow-same-origin"
        srcDoc={injectVisualBaseStyles(parsed.html)}
        title={parsed.title || "Visual"}
        onLoad={handleLoad}
      />
      {showExport && (
        <ExportDialog
          iframeRef={iframeRef}
          defaultTitle={parsed.title || "visual"}
          onClose={() => setShowExport(false)}
        />
      )}
    </div>
  );
}

/* ---- Main component ---- */

interface AssistantContentProps {
  parts: AssistantPart[];
  streaming?: boolean;
  workspacePath?: string;
  onSendAnnotation?: (text: string, files: AttachedFile[]) => void;
}

export default function AssistantContent({ parts, streaming, workspacePath, onSendAnnotation }: AssistantContentProps) {
  if (parts.length === 0) return null;

  return (
    <>
      {parts.map((part, i) => {
        if (part.kind === "thinking") {
          if (streaming) {
            const done = parts.slice(i + 1).some(p => p.kind !== "thinking");
            return (
              <div key={`thinking-${i}`} className={`process-strip is-thinking ${done ? "is-done" : "is-active"}`}>
                <div className="process-strip-inner">
                  <div className="process-strip-row">
                    <span className="process-strip-dot" />
                    <span className="process-strip-hint">{done ? "思考完成" : "思考中"}</span>
                  </div>
                </div>
              </div>
            );
          }
          return (
            <div key={`thinking-${i}`} className="process-strip is-done is-thinking">
              <div className="process-strip-inner">
                <details className="process-strip-details">
                  <summary className="process-strip-summary">
                    <span className="process-strip-dot" />
                    <span className="process-strip-summary-text">思考过程</span>
                    <span className="process-strip-summary-arrow">▸</span>
                  </summary>
                  <div className="process-strip-section-content">{part.text}</div>
                </details>
              </div>
            </div>
          );
        }

        if (part.kind === "tool") {
          // render_visual with result: render visual inline as content, skip tool strip
          if (part.visualData && part.status !== "running") {
            return <VisualWidget key={part.id} data={part.visualData} />;
          }
          if (streaming && part.status === "running") {
            const summary = toolArgsSummary(part.name, part.args);
            return (
              <div key={part.id} className="process-strip is-active">
                <div className="process-strip-inner">
                  <div className="process-strip-row">
                    <ToolStatus toolName={part.name} status={part.status} />
                    {summary && <span className="process-strip-hint">{summary}</span>}
                    <ToolElapsed />
                  </div>
                </div>
              </div>
            );
          }
          const summary = toolArgsSummary(part.name, part.args);
          const hasDetails = part.args || part.result;
          return (
            <div key={part.id} className="process-strip is-done">
              <div className="process-strip-inner">
                {hasDetails ? (
                  <details className="process-strip-details">
                    <summary className="process-strip-summary">
                      <ToolStatus toolName={part.name} status={part.status} />
                      {summary && <span className="process-strip-hint">{summary}</span>}
                      <span className="process-strip-summary-arrow">▸</span>
                    </summary>
                    <div className="process-strip-section-content">
                      <ToolResultView toolName={part.name} args={part.args} result={part.result} />
                    </div>
                  </details>
                ) : (
                  <div className="process-strip-row">
                    <ToolStatus toolName={part.name} status={part.status} />
                    {summary && <span className="process-strip-hint">{summary}</span>}
                  </div>
                )}
              </div>
              {part.filePath && (
                part.fileKind === "image"
                  ? <ImageResultCard filePath={part.filePath} workspacePath={workspacePath} onSendAnnotation={onSendAnnotation} />
                  : <ToolFileCard filePath={part.filePath} fileKind={part.fileKind} workspacePath={workspacePath} />
              )}
            </div>
          );
        }

        if (part.kind === "markdown") {
          return <Markdown key={`markdown-${i}`} content={part.text} workspacePath={workspacePath} />;
        }

        if (part.kind === "visual") {
          const visualData = JSON.stringify({ title: part.title, html: part.html });
          return <VisualWidget key={`visual-${i}`} data={visualData} />;
        }

        if (part.kind === "status") {
          return <div key={`status-${i}`} className="status-hint">{part.text}</div>;
        }

        return null;
      })}
    </>
  );
}
