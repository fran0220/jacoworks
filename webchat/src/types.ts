export interface User {
  id: string;
  name: string;
  email: string;
  role: string;
}

export type View = "workbench" | "tasks" | "team" | "observe";

export type OpsLens = "overview" | "timeline" | "board";

export type MessageContentItem =
  | { type: "text"; text: string }
  | { type: "thinking"; thinking: string }
  | { type: "toolcall" | "tool_call"; name: string; arguments?: unknown }
  | { type: "toolresult" | "tool_result"; name?: string; text?: string; output?: unknown };

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
    }
  | { type: "status"; text: string };
