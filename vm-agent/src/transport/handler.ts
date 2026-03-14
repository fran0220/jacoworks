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
import { log } from "../lib/logger.js";
import { promptWithRetry, sanitizePromptMessage } from "../lib/prompt-retry.js";

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

const PROMPT_TIMEOUT_MS = 5 * 60 * 1000;
const promptInFlight = new Map<string, { finish: (error?: string) => void; startedAt: number }>();

export function clearAllInFlight() {
  if (promptInFlight.size > 0) {
    log.warn(`clearing ${promptInFlight.size} stale in-flight locks`);
    for (const [, entry] of promptInFlight) {
      try { entry.finish("connection reset"); } catch {}
    }
    promptInFlight.clear();
  }
}

async function handlePrompt(config: Config, sender: TransportSender, command: PromptCommand) {
  const id = normalizeId(command.id);
  const traceId = String(id);

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

  const plog = log.child({ trace_id: traceId, session_id: sessionId, user_id: command.user_id });

  const existing = promptInFlight.get(sessionId);
  if (existing) {
    if (Date.now() - existing.startedAt > PROMPT_TIMEOUT_MS) {
      plog.warn("clearing stale in-flight lock", { age_ms: Date.now() - existing.startedAt });
      try { existing.finish("timeout"); } catch {}
      promptInFlight.delete(sessionId);
    } else {
      plog.warn("prompt rejected: in-flight");
      sendResponse(sender, id, command.type, false, { error: "prompt already in-flight for this session" });
      sendError(sender, id, sessionId, "prompt already in-flight for this session");
      sendDone(sender, id, sessionId);
      return;
    }
  }

  const startedAt = Date.now();
  promptInFlight.set(sessionId, { finish: () => {}, startedAt });

  plog.info("prompt started", { model: modelKey });

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
      const duration_ms = Date.now() - startedAt;
      if (error) {
        plog.error("prompt failed", { error, duration_ms });
        sendError(sender, id, sessionId, error);
      } else {
        plog.info("prompt completed", { duration_ms });
      }
      sendDone(sender, id, sessionId);
      unsub();
    };

    promptInFlight.set(sessionId, { finish, startedAt });

    const unsub = session.subscribe((event) => {
      if (finished) return;

      if (event.type === "message_update") {
        const ame = (event as { assistantMessageEvent?: { type?: string; delta?: string } }).assistantMessageEvent;
        if (ame?.type === "thinking_start") plog.debug("thinking_start");
        else if (ame?.type === "thinking_delta") plog.debug("thinking_delta", { chars: ame.delta?.length || 0 });
        else if (ame?.type === "thinking_end") plog.debug("thinking_end");
      } else if (event.type === "agent_start" || event.type === "agent_end" || event.type === "turn_start" || event.type === "turn_end") {
        plog.debug(event.type);
      } else if (event.type === "tool_execution_start" || event.type === "tool_execution_end") {
        const te = event as { toolName?: string };
        plog.debug(event.type, { tool: te.toolName || "?" });
      } else if (event.type === "auto_compaction_start" || event.type === "auto_compaction_end" || event.type === "auto_retry_start" || event.type === "auto_retry_end") {
        plog.info(event.type);
      }

      sender.send({ id, type: "session_event", session_id: sessionId, event });

      // Emit context_usage after turn_end so the frontend can display a context bar
      if (event.type === "turn_end") {
        const turnMsg = (event as { message?: { usage?: { input?: number; output?: number; totalTokens?: number } } }).message;
        const usage = turnMsg?.usage;
        if (usage) {
          const maxTokens = session.state.model?.contextWindow || 200000;
          sender.send({
            id,
            type: "session_event",
            session_id: sessionId,
            event: {
              type: "context_usage",
              usedTokens: usage.input || 0,
              maxTokens,
            },
          });
        }
      }
    });

    const options = session.isStreaming
      ? { streamingBehavior: command.streaming_behavior || "followUp" as const }
      : undefined;

    // Sanitize message and use retry logic
    const sanitizedMessage = sanitizePromptMessage(command.message);
    promptWithRetry(session, sanitizedMessage, options)
      .then(() => finish())
      .catch((err) => {
        finish(err instanceof Error ? err.message : "prompt failed");
      });
  } catch (err) {
    promptInFlight.delete(sessionId);
    const error = err instanceof Error ? err.message : "prompt failed";
    plog.error("prompt setup failed", { error });
    sendResponse(sender, id, command.type, false, { error });
    sendError(sender, id, sessionId, error);
    sendDone(sender, id, sessionId);
  }
}

export async function handleCommand(config: Config, sender: TransportSender, command: RawCommand) {
  // Route transport response messages to registered response handlers (remote-fs, etc.)
  const msgType = typeof command.type === "string" ? command.type : "";
  const isTransportResult = msgType.startsWith("fs.") && msgType.endsWith(".result");
  if (isTransportResult) {
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
