import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import hljs from "../lib/hljs-setup";
import { toolArgsSummary } from "../lib/tool-utils";
import type { AssistantPart, StreamBlock } from "../types";
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

/* ---- Main component ---- */

interface AssistantContentProps {
  parts: AssistantPart[];
  blocks?: StreamBlock[];
  streaming?: boolean;
  workspacePath?: string;
}

export default function AssistantContent({ parts, blocks, streaming, workspacePath }: AssistantContentProps) {
  const items = parts && parts.length > 0 ? parts : null;
  const streamBlocks = !items && blocks && blocks.length > 0 ? blocks : null;

  if (!items && !streamBlocks) return null;

  if (items) {
    return (
      <>
        {items.map((part, i) => {
          if (part.kind === "thinking") {
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
                  <ToolFileCard filePath={part.filePath} fileKind={part.fileKind} workspacePath={workspacePath} />
                )}
              </div>
            );
          }

          if (part.kind === "markdown") {
            return <Markdown key={`markdown-${i}`} content={part.text} workspacePath={workspacePath} />;
          }

          if (part.kind === "status") {
            return <div key={`status-${i}`} className="status-hint">{part.text}</div>;
          }

          return null;
        })}
      </>
    );
  }

  return (
    <>
      {streamBlocks!.map((block, i) => {
        if (block.type === "thinking") {
          const done = streamBlocks!.slice(i + 1).some(b => b.type !== "thinking");
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

        if (block.type === "tool") {
          const isRunning = block.status === "running";
          const summary = toolArgsSummary(block.name, block.args);
          return (
            <div key={block.id} className={`process-strip ${isRunning ? "is-active" : "is-done"}`}>
              <div className="process-strip-inner">
                <div className="process-strip-row">
                  <ToolStatus toolName={block.name} status={block.status} />
                  {summary && <span className="process-strip-hint">{summary}</span>}
                  {isRunning && <ToolElapsed />}
                </div>
              </div>
            </div>
          );
        }

        if (block.type === "text") {
          return <Markdown key={`text-${i}`} content={block.content} workspacePath={workspacePath} />;
        }

        if (block.type === "status") {
          return <div key={`status-${i}`} className="status-hint">{block.text}</div>;
        }

        return null;
      })}
    </>
  );
}
