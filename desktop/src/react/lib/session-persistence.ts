import type { ChatMessage } from "../types";
import { updateSession } from "./sessions";

export async function persistMessages(
  sessionId: string,
  messages: ChatMessage[],
  title?: string,
) {
  await updateSession(sessionId, {
    messages,
    ...(title ? { title } : {}),
  });
}

export async function persistSessionMeta(
  sessionId: string,
  data: { model?: string; workspacePath?: string; title?: string },
) {
  await updateSession(sessionId, data);
}
