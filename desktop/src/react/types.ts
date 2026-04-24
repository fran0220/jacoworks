export interface User {
  id: string;
  name: string;
  email: string;
  role: string;
}

export interface MessageContent {
  type: "text" | "image_url";
  text?: string;
  image_url?: { url: string };
}

export interface FileRef {
  name: string;
  size: number;
}

export type AssistantPart =
  | { kind: "markdown"; text: string }
  | { kind: "thinking"; text: string }
  | { kind: "tool"; id: string; name: string; status: "running" | "completed" | "error"; args?: string; result?: string; filePath?: string; fileKind?: string; visualData?: string; imageUrl?: string }
  | { kind: "visual"; id: string; visualType: string; title?: string; html: string }
  | { kind: "status"; text: string };

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string | MessageContent[];
  files?: FileRef[];
  parts?: AssistantPart[];
}

export interface AttachedFile {
  name: string;
  /** Workspace-relative path, e.g. "_attachments/report.pdf" */
  path: string;
  size: number;
}

export interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
  type: "chat" | "cowork";
  workspacePath: string;
  model: string;
  anonymous?: boolean;
}

export interface FilePreview {
  path: string;
  name: string;
  ext: string;
  size: number;
  category:
    | "image"
    | "code"
    | "markdown"
    | "text"
    | "docx"
    | "xlsx"
    | "pdf"
    | "video"
    | "audio"
    | "archive"
    | "csv"
    | "design"
    | "binary";
  content: string | null;
  language: string | null;
  entries?: string[] | null;
  metadata?: Record<string, string | number | boolean | null> | null;
}

export interface DirEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  ext: string;
  category: string;
}
