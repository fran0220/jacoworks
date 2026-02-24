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

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string | MessageContent[];
}

export interface AttachedFile {
  name: string;
  type: "image" | "text";
  data: string;
  size: number;
}

export interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
  type: string;
  workspacePath: string;
  model: string;
}
