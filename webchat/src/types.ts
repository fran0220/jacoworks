export interface User {
  id: string;
  name: string;
  email: string;
  role: string;
}

export type View = "agent" | "team" | "city";
export type AppMode = View;

export type AgentExpression = "idle" | "thinking" | "speaking" | "working" | "happy" | "error";

export type AgentPresenceTone = "idle" | "thinking" | "working";

export type FileCategory =
  | "image"
  | "pdf"
  | "docx"
  | "xlsx"
  | "code"
  | "text"
  | "csv"
  | "audio"
  | "video"
  | "archive"
  | "markdown"
  | "design"
  | "binary";

export interface FileArtifact {
  id: string;
  name: string;
  pathLabel?: string;
  ext?: string;
  mime?: string;
  size?: number | null;
  category?: FileCategory;
  contentUrl: string;
  downloadUrl: string;
  createdAt?: number;
  artifactId?: string;
  filename?: string;
  path?: string;
  mimeType?: string;
  containerName?: string;
  thumbnailUrl?: string;
}

export type MessageContentItem =
  | { type: "text"; text: string }
  | { type: "thinking"; thinking: string }
  | { type: "toolcall" | "tool_call"; name: string; arguments?: unknown }
  | {
      type: "toolresult" | "tool_result";
      name?: string;
      text?: string;
      output?: unknown;
      fileArtifact?: FileArtifact;
    };

export interface ChatSender {
  agentId: string;
  agentName: string;
  role: string;
}

export interface ChatOrchestration {
  action: string;
  detail: string;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string | MessageContentItem[];
  type?: "text" | "orchestration";
  sender?: ChatSender;
  orchestration?: ChatOrchestration;
  artifacts?: FileArtifact[];
  blocks?: StreamBlock[];
  timestamp?: number;
}

export interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
  type: "chat" | "cowork";
  model: string;
  workspacePath?: string;
}

export type StreamBlock =
  | { type: "thinking"; content: string }
  | { type: "text"; content: string }
  | {
      type: "tool";
      id: string;
      name: string;
      status: "running" | "completed" | "error";
      args?: unknown;
      output?: string;
      artifact?: FileArtifact;
    }
  | { type: "status"; text: string };
