import type { ChatMessage } from "../types";
import { updateSession } from "./sessions";

/**
 * Persist messages to DB with retry logic.
 * This is the single source of truth for session state.
 */
export async function persistMessages(
  sessionId: string,
  messages: ChatMessage[],
  title?: string,
  retries = 3,
) {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      await updateSession(sessionId, {
        messages,
        ...(title ? { title } : {}),
      });
      return; // Success
    } catch (err) {
      const isLastAttempt = attempt === retries - 1;
      if (isLastAttempt) {
        console.error("[persist] failed after retries:", err);
        throw err;
      }
      // Exponential backoff: 1s, 2s, 4s
      const delayMs = 1000 * Math.pow(2, attempt);
      console.warn(`[persist] attempt ${attempt + 1} failed, retry in ${delayMs}ms:`, err);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

export async function persistSessionMeta(
  sessionId: string,
  data: { model?: string; workspacePath?: string; title?: string },
) {
  await updateSession(sessionId, data);
}
