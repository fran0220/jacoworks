import { invoke } from "@tauri-apps/api/core";
import type { CloudAgentWS } from "./cloud-agent-ws";

function isPathSafe(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, "/");
  if (normalized.includes("..")) return false;
  if (normalized.startsWith("/")) return false;
  return true;
}

interface FileEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
}

interface FileStat {
  exists: boolean;
  is_dir: boolean;
  size: number;
}

export async function handleFileRequest(
  ws: CloudAgentWS,
  workspacePath: string,
  request: Record<string, unknown>,
): Promise<void> {
  const type = request.type as string;
  const reqId = request.req_id as string | undefined;

  try {
    if (type === "fs.read") {
      await handleRead(ws, workspacePath, request);
    } else if (type === "fs.write") {
      await handleWrite(ws, workspacePath, request);
    } else if (type === "fs.list") {
      await handleList(ws, workspacePath, request);
    } else if (type === "fs.stat") {
      await handleStat(ws, workspacePath, request);
    } else {
      ws.send({ type: `${type}.result`, req_id: reqId, error: `Unknown fs operation: ${type}` });
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    ws.send({ type: `${type}.result`, req_id: reqId, error: errorMsg });
  }
}

async function handleRead(
  ws: CloudAgentWS,
  workspacePath: string,
  request: Record<string, unknown>,
): Promise<void> {
  const reqId = request.req_id as string;
  const path = request.path as string;

  if (!isPathSafe(path)) {
    ws.send({ type: "fs.read.result", req_id: reqId, error: "Path traversal not allowed" });
    return;
  }

  // Rust-side safe_resolve enforces workspace containment (including symlink escape)
  const content = await invoke<string>("read_file_text", {
    workspace: workspacePath,
    relativePath: path,
  });
  const base64Content = btoa(
    new Uint8Array(new TextEncoder().encode(content)).reduce(
      (data, byte) => data + String.fromCharCode(byte),
      "",
    ),
  );

  ws.send({
    type: "fs.read.result",
    req_id: reqId,
    content: base64Content,
    size: new TextEncoder().encode(content).byteLength,
  });
}

async function handleWrite(
  ws: CloudAgentWS,
  workspacePath: string,
  request: Record<string, unknown>,
): Promise<void> {
  const reqId = request.req_id as string;
  const path = request.path as string;
  const contentB64 = request.content as string;

  if (!isPathSafe(path)) {
    ws.send({ type: "fs.write.result", req_id: reqId, error: "Path traversal not allowed" });
    return;
  }

  const decoded = new TextDecoder().decode(
    Uint8Array.from(atob(contentB64), (c) => c.charCodeAt(0)),
  );

  await invoke("write_file_text", {
    workspace: workspacePath,
    relativePath: path,
    content: decoded,
  });
  ws.send({ type: "fs.write.result", req_id: reqId, ok: true });
}

async function handleList(
  ws: CloudAgentWS,
  workspacePath: string,
  request: Record<string, unknown>,
): Promise<void> {
  const reqId = request.req_id as string;
  const path = (request.path as string) || ".";
  const recursive = (request.recursive as boolean) ?? false;

  if (path !== "." && !isPathSafe(path)) {
    ws.send({ type: "fs.list.result", req_id: reqId, error: "Path traversal not allowed" });
    return;
  }

  const entries = await invoke<FileEntry[]>("list_directory", {
    workspace: workspacePath,
    relativePath: path === "." ? "" : path,
    recursive,
  });
  ws.send({ type: "fs.list.result", req_id: reqId, entries });
}

async function handleStat(
  ws: CloudAgentWS,
  workspacePath: string,
  request: Record<string, unknown>,
): Promise<void> {
  const reqId = request.req_id as string;
  const path = request.path as string;

  if (!isPathSafe(path)) {
    ws.send({ type: "fs.stat.result", req_id: reqId, error: "Path traversal not allowed" });
    return;
  }

  const stat = await invoke<FileStat>("file_stat", {
    workspace: workspacePath,
    relativePath: path,
  });
  ws.send({
    type: "fs.stat.result",
    req_id: reqId,
    exists: stat.exists,
    is_dir: stat.is_dir,
    size: stat.size,
  });
}
