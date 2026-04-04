import { Type } from "@sinclair/typebox";
import { defineTool, type ExtensionFactory } from "@mariozechner/pi-coding-agent";
import type { TransportSender } from "../transport/types.js";

const REQUEST_TIMEOUT_MS = 30_000;

// ─── Protocol Types ─────────────────────────────────

export interface FsReadRequest {
  type: "fs.read";
  req_id: string;
  path: string;
}

export interface FsWriteRequest {
  type: "fs.write";
  req_id: string;
  path: string;
  content: string; // base64
}

export interface FsListRequest {
  type: "fs.list";
  req_id: string;
  path: string;
  recursive: boolean;
}

export interface FsStatRequest {
  type: "fs.stat";
  req_id: string;
  path: string;
}

export interface FsEntry {
  name: string;
  is_dir: boolean;
  size: number;
}

// ─── Pending Request Tracking ───────────────────────

interface PendingRequest {
  resolve: (data: Record<string, unknown>) => void;
  reject: (err: Error) => void;
}

// ─── Tool Parameter Schemas ─────────────────────────

const ReadParams = Type.Object({
  path: Type.String({ description: "Relative path to the file on the user's local machine" }),
});

const WriteParams = Type.Object({
  path: Type.String({ description: "Relative path to the file on the user's local machine" }),
  content: Type.String({ description: "File content to write" }),
});

const ListParams = Type.Object({
  path: Type.String({ description: "Relative path to the directory on the user's local machine" }),
  recursive: Type.Optional(Type.Boolean({ description: "Whether to list recursively", default: false })),
});

const StatParams = Type.Object({
  path: Type.String({ description: "Relative path to the file/directory on the user's local machine" }),
});

// ─── Extension Factory ──────────────────────────────

export function createRemoteFsExtension(
  getSender: () => TransportSender | null,
  registerResponseHandler: (handler: (msg: Record<string, unknown>) => boolean) => void,
): ExtensionFactory {
  return (pi) => {
    const pending = new Map<string, PendingRequest>();

    // Register handler for fs.*.result messages
    registerResponseHandler((msg) => {
      const msgType = typeof msg.type === "string" ? msg.type : "";
      if (!msgType.startsWith("fs.") || !msgType.endsWith(".result")) return false;

      const reqId = typeof msg.req_id === "string" ? msg.req_id : "";
      if (!reqId) return false; // not ours — let other handlers try

      const entry = pending.get(reqId);
      if (!entry) return false; // not our request — let other handlers try

      pending.delete(reqId);
      if (typeof msg.error === "string") {
        entry.reject(new Error(msg.error));
      } else {
        entry.resolve(msg);
      }
      return true;
    });

    function sendRequest(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
      const reqId = crypto.randomUUID();
      payload.req_id = reqId;

      return new Promise((resolve, reject) => {
        const sender = getSender();
        if (!sender) {
          reject(new Error("Cloud file channel disconnected"));
          return;
        }

        const timer = setTimeout(() => {
          pending.delete(reqId);
          reject(new Error(`Remote FS request timed out after ${REQUEST_TIMEOUT_MS / 1000}s`));
        }, REQUEST_TIMEOUT_MS);

        pending.set(reqId, {
          resolve: (data) => {
            clearTimeout(timer);
            resolve(data);
          },
          reject: (err) => {
            clearTimeout(timer);
            reject(err);
          },
        });

        sender.send(payload);
      });
    }

    // ── remote_read ──
    const remoteRead = defineTool<typeof ReadParams, Record<string, unknown>>({
      name: "remote_read",
      label: "Remote Read",
      description:
        "Read a file from the user's local machine (via WebSocket). The path is relative to the user's workspace root.",
      promptSnippet:
        "Use to read a file from the user's local machine when running in cloud mode and the needed file is not inside the container.",
      parameters: ReadParams,
      execute: async (_toolCallId, params) => {
        const result = await sendRequest({ type: "fs.read", path: params.path });
        const content = typeof result.content === "string"
          ? Buffer.from(result.content, "base64").toString("utf-8")
          : "";
        return {
          content: [{ type: "text" as const, text: content }],
          details: { size: result.size ?? content.length },
        };
      },
    });

    // ── remote_write ──
    const remoteWrite = defineTool<typeof WriteParams, Record<string, unknown>>({
      name: "remote_write",
      label: "Remote Write",
      description:
        "Write a file to the user's local machine (via WebSocket). The path is relative to the user's workspace root.",
      promptSnippet:
        "Use to write or update a file on the user's local machine from cloud mode.",
      parameters: WriteParams,
      execute: async (_toolCallId, params) => {
        const encoded = Buffer.from(params.content, "utf-8").toString("base64");
        await sendRequest({ type: "fs.write", path: params.path, content: encoded });
        return {
          content: [{ type: "text" as const, text: `Successfully wrote to ${params.path}` }],
          details: {},
        };
      },
    });

    // ── remote_list ──
    const remoteList = defineTool<typeof ListParams, Record<string, unknown>>({
      name: "remote_list",
      label: "Remote List",
      description:
        "List directory contents on the user's local machine (via WebSocket). The path is relative to the user's workspace root.",
      promptSnippet:
        "Use to inspect directories on the user's local machine from cloud mode before reading or writing files there.",
      parameters: ListParams,
      execute: async (_toolCallId, params) => {
        const result = await sendRequest({
          type: "fs.list",
          path: params.path,
          recursive: params.recursive ?? false,
        });
        const entries = Array.isArray(result.entries) ? (result.entries as FsEntry[]) : [];
        const text = entries.length === 0
          ? "(empty directory)"
          : entries
              .map((e) => `${e.is_dir ? "📁" : "📄"} ${e.name}${e.is_dir ? "/" : ""} (${e.size} bytes)`)
              .join("\n");
        return {
          content: [{ type: "text" as const, text }],
          details: { count: entries.length },
        };
      },
    });

    // ── remote_stat ──
    const remoteStat = defineTool<typeof StatParams, Record<string, unknown>>({
      name: "remote_stat",
      label: "Remote Stat",
      description:
        "Check if a file or directory exists on the user's local machine (via WebSocket). The path is relative to the user's workspace root.",
      promptSnippet:
        "Use to check whether a local file or directory exists, and whether it is a file or directory, from cloud mode.",
      parameters: StatParams,
      execute: async (_toolCallId, params) => {
        const result = await sendRequest({ type: "fs.stat", path: params.path });
        const exists = result.exists === true;
        const text = exists
          ? `${params.path}: exists, ${result.is_dir ? "directory" : "file"}, ${result.size ?? 0} bytes`
          : `${params.path}: does not exist`;
        return {
          content: [{ type: "text" as const, text }],
          details: { exists, is_dir: result.is_dir ?? false, size: result.size ?? 0 },
        };
      },
    });

    pi.registerTool(remoteRead);
    pi.registerTool(remoteWrite);
    pi.registerTool(remoteList);
    pi.registerTool(remoteStat);
  };
}
