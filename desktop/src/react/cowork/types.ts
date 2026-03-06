export interface OcProxyReadyFrame {
  type: "proxy.ready";
}

export interface OcProxyErrorFrame {
  type: "proxy.error";
  error?: string;
}

export interface OcPingFrame {
  type: "ping";
}

export interface OcPongFrame {
  type: "pong";
}

export interface OcReq<TParams = unknown> {
  type: "req";
  id: string;
  method: string;
  params: TParams;
}

export interface OcRes<TResult = unknown> {
  type: "res";
  id: string;
  ok?: boolean;
  result?: TResult;
  error?: string | { message?: string };
}

export interface OcEvent<TPayload = unknown> {
  type: "event";
  event: string;
  payload?: TPayload;
  [key: string]: unknown;
}

export type OcFrame = OcProxyReadyFrame | OcProxyErrorFrame | OcPongFrame | OcRes | OcEvent;

export interface OcAttachment {
  type: "image";
  mimeType: string;
  fileName: string;
  content: string; // raw base64 (no data: prefix)
}

export interface OcChatSendParams {
  sessionKey: string;
  message: string;
  deliver: boolean;
  idempotencyKey: string;
  attachments?: OcAttachment[];
}

export interface OcChatAbortParams {
  sessionKey: string;
}

export function createOcId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
