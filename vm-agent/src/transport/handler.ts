import {
  getSession,
  abortSession,
  listSessions,
  resolveModel,
  destroySession,
  generateSessionTitle,
  listAvailableSkills,
} from "../agent.js";
import type { Config } from "../config.js";
import type { TransportSender } from "./types.js";

type RpcId = string | number;

// ─── Response Handler Registry (for remote-fs etc.) ──

type ResponseHandler = (msg: Record<string, unknown>) => boolean;
const responseHandlers: ResponseHandler[] = [];

export function registerTransportResponseHandler(handler: ResponseHandler) {
  responseHandlers.push(handler);
  return () => {
    const idx = responseHandlers.indexOf(handler);
    if (idx >= 0) responseHandlers.splice(idx, 1);
  };
}

interface RpcCommandBase {
  id?: RpcId;
  type: string;
}

interface PromptCommand extends RpcCommandBase {
  type: "prompt";
  message: string;
  model?: string;
  session_id?: string;
  user_id?: string;
  workspace?: string;
  restricted?: boolean;
  streaming_behavior?: "steer" | "followUp";
  thinking_level?: string;
  anonymous?: boolean;
}

type RawCommand = RpcCommandBase & Record<string, unknown>;

export { type RpcId, type RawCommand, type PromptCommand };

function normalizeId(id: RpcId | undefined): RpcId {
  return id ?? `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function sendResponse(sender: TransportSender, id: RpcId | undefined, command: string, success: boolean, data?: unknown) {
  sender.send({ id, type: "response", command, success, data });
}

function sendError(sender: TransportSender, id: RpcId | undefined, sessionId: string | undefined, message: string) {
  sender.send({ id, type: "error", session_id: sessionId, error: message });
}

function sendDone(sender: TransportSender, id: RpcId | undefined, sessionId: string | undefined) {
  sender.send({ id, type: "done", session_id: sessionId });
}

const promptInFlight = new Map<string, { finish: (error?: string) => void }>();

async function handlePrompt(config: Config, sender: TransportSender, command: PromptCommand) {
  const id = normalizeId(command.id);

  if (!command.message?.trim()) {
    sendResponse(sender, id, command.type, false, { error: "message required" });
    sendError(sender, id, command.session_id, "message required");
    sendDone(sender, id, command.session_id);
    return;
  }

  const requestedModel = resolveModel(command.model);
  if (command.model && !requestedModel) {
    const sessionId = command.session_id || "invalid-model";
    const error = `unsupported model: ${command.model}`;
    sendResponse(sender, id, command.type, false, { error });
    sendError(sender, id, sessionId, error);
    sendDone(sender, id, sessionId);
    return;
  }

  const modelKey = requestedModel
    ? `${requestedModel.provider}/${requestedModel.id}`
    : `${config.primaryProvider}/${config.primaryModel}`;
  const sessionId = command.session_id || modelKey;

  if (promptInFlight.has(sessionId)) {
    sendResponse(sender, id, command.type, false, { error: "prompt already in-flight for this session" });
    sendError(sender, id, sessionId, "prompt already in-flight for this session");
    sendDone(sender, id, sessionId);
    return;
  }

  promptInFlight.set(sessionId, { finish: () => {} });

  try {
    const { session } = await getSession(sessionId, {
      userId: command.user_id,
      workspace: command.workspace,
      restricted: command.restricted,
      model: requestedModel,
      anonymous: command.anonymous,
    });

    if (requestedModel) {
      await session.setModel(requestedModel);
    }

    if (command.thinking_level) {
      const validLevels = ["off", "minimal", "low", "medium", "high", "xhigh"];
      if (validLevels.includes(command.thinking_level)) {
        session.setThinkingLevel(command.thinking_level as "off" | "minimal" | "low" | "medium" | "high" | "xhigh");
      }
    }

    sendResponse(sender, id, command.type, true, { session_id: sessionId, model: modelKey });

    let finished = false;
    const keepaliveId = setInterval(() => {
      sender.send({ id, type: "session_event", session_id: sessionId, event: { type: "keepalive" } });
    }, 15_000);

    const finish = (error?: string) => {
      if (finished) return;
      finished = true;
      clearInterval(keepaliveId);
      promptInFlight.delete(sessionId);
      if (error) {
        sendError(sender, id, sessionId, error);
      }
      sendDone(sender, id, sessionId);
      unsub();
    };

    promptInFlight.set(sessionId, { finish });

    const unsub = session.subscribe((event) => {
      if (finished) return;

      if (event.type === "message_update") {
        const ame = (event as { assistantMessageEvent?: { type?: string; delta?: string } }).assistantMessageEvent;
        if (ame?.type === "thinking_start") console.error("[stream] thinking_start");
        else if (ame?.type === "thinking_delta") console.error(`[stream] thinking_delta (${ame.delta?.length || 0} chars)`);
        else if (ame?.type === "thinking_end") console.error("[stream] thinking_end");
      } else if (event.type === "agent_start" || event.type === "agent_end" || event.type === "turn_start" || event.type === "turn_end") {
        console.error(`[stream] ${event.type}`);
      } else if (event.type === "tool_execution_start" || event.type === "tool_execution_end") {
        const te = event as { toolName?: string };
        console.error(`[stream] ${event.type}: ${te.toolName || "?"}`);
      } else if (event.type === "auto_compaction_start" || event.type === "auto_compaction_end" || event.type === "auto_retry_start" || event.type === "auto_retry_end") {
        console.error(`[stream] ${event.type}`);
      }

      sender.send({ id, type: "session_event", session_id: sessionId, event });
    });

    const options = session.isStreaming
      ? { streamingBehavior: command.streaming_behavior || "followUp" as const }
      : undefined;

    session.prompt(command.message, options)
      .then(() => finish())
      .catch((err) => {
        finish(err instanceof Error ? err.message : "prompt failed");
      });
  } catch (err) {
    promptInFlight.delete(sessionId);
    const error = err instanceof Error ? err.message : "prompt failed";
    sendResponse(sender, id, command.type, false, { error });
    sendError(sender, id, sessionId, error);
    sendDone(sender, id, sessionId);
  }
}

export async function handleCommand(config: Config, sender: TransportSender, command: RawCommand) {
  // Route fs.*.result messages to registered response handlers (remote-fs etc.)
  const msgType = typeof command.type === "string" ? command.type : "";
  if (msgType.startsWith("fs.") && msgType.endsWith(".result")) {
    for (const handler of responseHandlers) {
      if (handler(command as Record<string, unknown>)) return;
    }
    return;
  }

  switch (command.type) {
    case "health":
      sendResponse(sender, command.id, command.type, true, {
        status: "ok",
        service: "vm-agent",
        version: "0.2.0-rpc",
        sessions: listSessions().length,
      });
      return;

    case "list_skills":
      sendResponse(sender, command.id, command.type, true, {
        skills: listAvailableSkills(),
      });
      return;

    case "list_sessions":
      sendResponse(sender, command.id, command.type, true, { sessions: listSessions() });
      return;

    case "destroy_session": {
      const sessionId = typeof command.session_id === "string" ? command.session_id : "";
      if (!sessionId) {
        sendResponse(sender, command.id, command.type, false, { error: "session_id required" });
        return;
      }
      const removed = destroySession(sessionId);
      sendResponse(sender, command.id, command.type, removed, { removed });
      return;
    }

    case "abort": {
      const sessionId = typeof command.session_id === "string" ? command.session_id : "";
      if (!sessionId) {
        sendResponse(sender, command.id, command.type, false, { error: "session_id required" });
        return;
      }
      const aborted = await abortSession(sessionId);

      const inFlight = promptInFlight.get(sessionId);
      if (inFlight?.finish) {
        setTimeout(() => {
          if (promptInFlight.has(sessionId)) {
            inFlight.finish("aborted");
          }
        }, 3_000);
      }

      sendResponse(sender, command.id, command.type, aborted, { aborted, session_id: sessionId });
      return;
    }

    case "prompt": {
      if (typeof command.message !== "string") {
        sendResponse(sender, command.id, command.type, false, { error: "message required" });
        return;
      }
      await handlePrompt(config, sender, command as unknown as PromptCommand);
      return;
    }

    case "generate_title": {
      const userMsg = typeof command.user_message === "string" ? command.user_message : "";
      const assistantMsg = typeof command.assistant_message === "string" ? command.assistant_message : "";
      if (!assistantMsg) {
        sendResponse(sender, command.id, command.type, false, { error: "assistant_message required" });
        return;
      }
      try {
        const title = await generateSessionTitle(userMsg, assistantMsg);
        sendResponse(sender, command.id, command.type, true, { title });
      } catch (err) {
        sendResponse(sender, command.id, command.type, false, {
          error: err instanceof Error ? err.message : "title generation failed",
        });
      }
      return;
    }

    default:
      sendResponse(sender, command.id, command.type, false, {
        error: `unsupported command: ${command.type}`,
      });
  }
}
