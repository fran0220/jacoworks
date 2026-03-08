export interface User {
  id: string;
  name: string;
  email: string;
  role: string;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
  blocks?: StreamBlock[];
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
  | { type: "tool"; id: string; name: string; status: "running" | "completed" | "error" }
  | { type: "status"; text: string };
