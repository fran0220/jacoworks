import { invoke } from "@tauri-apps/api/core";
import {
  ChevronRight,
  File,
  FileCode,
  FileImage,
  FileMusic,
  FileSpreadsheet,
  FileText,
  FileVideo,
  Folder,
  FolderOpen,
  Package,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { DirEntry } from "../types";
import { formatSize } from "../lib/file-utils";

/* ===== Helpers ===== */

function fileIcon(entry: DirEntry, isOpen?: boolean) {
  if (entry.is_dir) return isOpen ? <FolderOpen size={14} /> : <Folder size={14} />;
  switch (entry.category) {
    case "image": return <FileImage size={14} />;
    case "code": return <FileCode size={14} />;
    case "markdown": case "text": return <FileText size={14} />;
    case "video": return <FileVideo size={14} />;
    case "audio": return <FileMusic size={14} />;
    case "xlsx": case "csv": return <FileSpreadsheet size={14} />;
    case "archive": return <Package size={14} />;
    default: return <File size={14} />;
  }
}

/* ===== TreeNode ===== */

function TreeNode({
  entry,
  depth,
  activePath,
  workspace,
  onSelect,
}: {
  entry: DirEntry;
  depth: number;
  activePath: string | null;
  workspace?: string;
  onSelect: (path: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<DirEntry[] | null>(null);
  const [loading, setLoading] = useState(false);

  const toggle = useCallback(async () => {
    if (!entry.is_dir) {
      onSelect(entry.path);
      return;
    }
    const next = !expanded;
    setExpanded(next);
    if (next && children === null) {
      setLoading(true);
      try {
        const result = await invoke<DirEntry[]>("list_directory", {
          path: entry.path,
          workspace: workspace || null,
        });
        setChildren(result);
      } catch {
        setChildren([]);
      } finally {
        setLoading(false);
      }
    }
  }, [entry, expanded, children, workspace, onSelect]);

  const isActive = !entry.is_dir && activePath === entry.path;

  return (
    <>
      <button
        className={`ft-node${isActive ? " active" : ""}${entry.is_dir ? " is-dir" : ""}`}
        style={{ paddingLeft: entry.is_dir ? 8 + depth * 16 : 8 + depth * 16 + 14 }}
        onClick={toggle}
        title={entry.is_dir ? entry.name : `${entry.name} · ${formatSize(entry.size)}`}
      >
        {entry.is_dir && (
          <span className={`ft-chevron${expanded ? " open" : ""}`}>
            <ChevronRight size={12} />
          </span>
        )}
        <span className={`ft-icon${entry.is_dir ? " dir" : ` cat-${entry.category}`}`}>
          {fileIcon(entry, expanded)}
        </span>
        <span className="ft-name">{entry.name}</span>
        {!entry.is_dir && entry.ext && (
          <span className="ft-ext">.{entry.ext}</span>
        )}
      </button>
      {expanded && entry.is_dir && (
        <div className="ft-children">
          {loading && (
            <div className="ft-loading" style={{ paddingLeft: 8 + (depth + 1) * 16 }}>
              加载中...
            </div>
          )}
          {children && children.length === 0 && !loading && (
            <div className="ft-empty" style={{ paddingLeft: 8 + (depth + 1) * 16 }}>
              空目录
            </div>
          )}
          {children?.map((child) => (
            <TreeNode
              key={child.path}
              entry={child}
              depth={depth + 1}
              activePath={activePath}
              workspace={workspace}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </>
  );
}

/* ===== Main Component ===== */

export default function FileTreeSidebar({
  rootPath,
  activePath,
  workspace,
  onSelect,
}: {
  rootPath: string;
  activePath: string | null;
  workspace?: string;
  onSelect: (path: string) => void;
}) {
  const [entries, setEntries] = useState<DirEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Extract directory name for display
  const dirName = rootPath.split("/").filter(Boolean).pop() || rootPath;

  useEffect(() => {
    setLoading(true);
    setError(null);
    invoke<DirEntry[]>("list_directory", { path: rootPath, workspace: workspace || null })
      .then(setEntries)
      .catch((err) => setError(String(err)))
      .finally(() => setLoading(false));
  }, [rootPath, workspace]);

  // Scroll active item into view
  useEffect(() => {
    if (!activePath || !scrollRef.current) return;
    const el = scrollRef.current.querySelector(".ft-node.active");
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activePath]);

  const handleSelect = useCallback(
    (path: string) => {
      onSelect(path);
    },
    [onSelect],
  );

  return (
    <div className="ft-sidebar">
      <div className="ft-header">
        <Folder size={13} />
        <span className="ft-header-name" title={rootPath}>{dirName}</span>
      </div>
      <div className="ft-tree" ref={scrollRef}>
        {loading && <div className="ft-loading">加载中...</div>}
        {error && <div className="ft-error">{error}</div>}
        {entries?.map((entry) => (
          <TreeNode
            key={entry.path}
            entry={entry}
            depth={0}
            activePath={activePath}
            workspace={workspace}
            onSelect={handleSelect}
          />
        ))}
      </div>
    </div>
  );
}
