import type { ConversationAction, ConversationState } from "./types";

export function createInitialConversationState(): ConversationState {
  return {
    messages: [],
    blocks: [],
    streaming: false,
    streamingAgents: new Set<string>(),
    error: null,
    connState: "disconnected",
  };
}

export function conversationReducer(
  state: ConversationState,
  action: ConversationAction,
): ConversationState {
  switch (action.type) {
    case "set_messages":
      return { ...state, messages: action.messages };
    case "set_blocks":
      return { ...state, blocks: action.blocks };
    case "set_streaming":
      return { ...state, streaming: action.streaming };
    case "set_error":
      return { ...state, error: action.error };
    case "set_conn_state":
      return { ...state, connState: action.connState };
    case "reset":
      return {
        ...state,
        messages: [],
        blocks: [],
        streaming: false,
        error: null,
        streamingAgents: new Set<string>(),
      };
    default:
      return state;
  }
}
