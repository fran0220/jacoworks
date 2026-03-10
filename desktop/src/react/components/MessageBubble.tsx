import { FileText } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import hljs from "../lib/hljs-setup";
import { memo, useEffect, useState } from "react";
import { formatSize } from "../lib/file-utils";
import { toolArgsSummary } from "../lib/tool-utils";
import type { ChatMessage, FileRef, MessageContent, StreamBlock } from "../types";
import ToolStatus from "./ToolStatus";
import Markdown from "./Markdown";

function extractText(content: string | MessageContent[]) {
  if (typeof content === "string") return content;
  return content
    .filter((part) => part.type === "text")
    .map((part) => part.text || "")
    .join("\n");
}

function extractImages(content: string | MessageContent[]) {
  if (typeof content === "string") return [];
  return content
    .filter((part) => part.type === "image_url" && part.image_url?.url)
    .map((part) => part.image_url!.url);
}

function FileIcon() {
  return <FileText size={14} />;
}

function FileBadges({ files }: { files: FileRef[] }) {
  if (files.length === 0) return null;
  return (
    <div className="msg-files">
      {files.map((file, i) => (
        <div className="msg-file-badge" key={`${file.name}-${i}`}>
          <FileIcon />
          <span className="msg-file-name" title={file.name}>{file.name}</span>
          <span className="msg-file-size">{formatSize(file.size)}</span>
        </div>
      ))}
    </div>
  );
}

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

  // Default: raw display
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

  const handlePreview = () => {
    window.dispatchEvent(new CustomEvent("preview-file", { detail: { path: filePath } }));
  };
  const handleOpen = () => {
    invoke("open_file_default", { path: filePath, workspace: workspacePath || null }).catch(() => {});
  };
  const handleReveal = () => {
    invoke("reveal_in_finder", { path: filePath, workspace: workspacePath || null }).catch(() => {});
  };

  return (
    <div className={`tool-file-card${isImage ? " has-thumb" : ""}`} onClick={handlePreview}>
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
      <div className="tool-file-card-actions">
        <button className="tool-file-card-btn" onClick={(e) => { e.stopPropagation(); handlePreview(); }}>预览</button>
        <button className="tool-file-card-btn" onClick={(e) => { e.stopPropagation(); handleReveal(); }}>目录</button>
        <button className="tool-file-card-btn accent" onClick={(e) => { e.stopPropagation(); handleOpen(); }}>打开</button>
      </div>
    </div>
  );
}

function AssistantBlocks({ blocks, workspacePath }: { blocks: StreamBlock[]; workspacePath?: string }) {
  const thinkingBlocks = blocks.filter((b): b is Extract<StreamBlock, { type: "thinking" }> => b.type === "thinking");
  const toolBlocks = blocks.filter((b): b is Extract<StreamBlock, { type: "tool" }> => b.type === "tool");

  if (thinkingBlocks.length === 0 && toolBlocks.length === 0) return null;

  return (
    <>
      {thinkingBlocks.map((block, i) => (
        <div key={`thinking-${i}`} className="process-strip is-done is-thinking">
          <div className="process-strip-inner">
            <details className="process-strip-details">
              <summary className="process-strip-summary">
                <span className="process-strip-dot" />
                <span className="process-strip-summary-text">思考过程</span>
                <span className="process-strip-summary-arrow">▸</span>
              </summary>
              <div className="process-strip-section-content">{block.content}</div>
            </details>
          </div>
        </div>
      ))}
      {toolBlocks.map((block) => {
        const summary = toolArgsSummary(block.name, block.args);
        const hasDetails = block.args || block.result;
        return (
          <div key={block.id} className="process-strip is-done">
            <div className="process-strip-inner">
              {hasDetails ? (
                <details className="process-strip-details">
                  <summary className="process-strip-summary">
                    <ToolStatus toolName={block.name} status={block.status} />
                    {summary && <span className="process-strip-hint">{summary}</span>}
                    <span className="process-strip-summary-arrow">▸</span>
                  </summary>
                  <div className="process-strip-section-content">
                    <ToolResultView toolName={block.name} args={block.args} result={block.result} />
                  </div>
                </details>
              ) : (
                <div className="process-strip-row">
                  <ToolStatus toolName={block.name} status={block.status} />
                  {summary && <span className="process-strip-hint">{summary}</span>}
                </div>
              )}
            </div>
            {block.filePath && (
              <ToolFileCard filePath={block.filePath} fileKind={block.fileKind} workspacePath={workspacePath} />
            )}
          </div>
        );
      })}
    </>
  );
}

const MessageBubble = memo(function MessageBubble({
  message,
  workspacePath,
}: {
  message: ChatMessage;
  workspacePath?: string;
}) {
  const isUser = message.role === "user";
  const text = extractText(message.content);
  const images = extractImages(message.content);
  const files = message.files || [];
  const blocks = message.blocks || [];

  return (
    <div className={`bubble-row ${isUser ? "user" : "assistant"}`}>
      <div className={`bubble ${isUser ? "user-bubble" : "assistant-bubble"}`}>
        {isUser ? (
          <>
            <FileBadges files={files} />
            {images.length > 0 && (
              <div className="attached-images">
                {images.map((url) => (
                  <img key={url} src={url} alt="附件图片" className="attached-img" loading="lazy" />
                ))}
              </div>
            )}
            <p className="user-text">{text}</p>
          </>
        ) : (
          <>
            <AssistantBlocks blocks={blocks} workspacePath={workspacePath} />
            {text.trim() && (
              <Markdown content={text} workspacePath={workspacePath} />
            )}
          </>
        )}
      </div>
    </div>
  );
});

export default MessageBubble;
