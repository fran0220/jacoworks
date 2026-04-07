import type { MutableRefObject } from "react";
import type { ConnectionState } from "../../lib/ws-relay-client";
import type { ChatMessage, StreamBlock } from "../../types";

export interface ConversationState {
  messages: ChatMessage[];
  blocks: StreamBlock[];
  streaming: boolean;
  streamingAgents: Set<string>;
  error: string | null;
  connState: ConnectionState;
}

export type ConversationAction =
  | { type: "set_messages"; messages: ChatMessage[] }
  | { type: "set_blocks"; blocks: StreamBlock[] }
  | { type: "set_streaming"; streaming: boolean }
  | { type: "set_error"; error: string | null }
  | { type: "set_conn_state"; connState: ConnectionState }
  | { type: "reset" };

export interface ObservatoryBridgeEvent {
  kind: string;
  text?: string;
  toolName?: string;
}

export interface UseConversationResult extends ConversationState {
  send: (text: string) => Promise<void>;
  abort: () => void;
  observatoryEventRef: MutableRefObject<((event: ObservatoryBridgeEvent) => void) | null>;
}
