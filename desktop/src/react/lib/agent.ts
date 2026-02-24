import { AGENT_URL } from "./config";
import { httpFetch, streamFetch } from "./transport";

export async function startNativeStream(payload: {
  session_id: string;
  model?: string;
  message: string;
  workspace?: string;
  restricted?: boolean;
}) {
  return streamFetch(`${AGENT_URL}/v1/chat/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function abortNativeSession(sessionId: string) {
  return httpFetch(`${AGENT_URL}/api/sessions/${sessionId}/abort`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
}
