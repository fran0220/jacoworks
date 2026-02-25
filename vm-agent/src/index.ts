import { createInterface } from "node:readline";
import { loadConfig } from "./config.js";
import {
  initAgent,
  getSession,
  abortSession,
  listSessions,
  resolveModel,
  startBackgroundServices,
  destroySession,
  destroyAllSessions,
  cleanupStaleSessions,
  generateSessionTitle,
  listAvailableSkills,
} from "./agent.js";

type RpcId = string | number;

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
}

interface AbortCommand extends RpcCommandBase {
  type: "abort";
  session_id: string;
}

interface DestroySessionCommand extends RpcCommandBase {
  type: "destroy_session";
  session_id: string;
}

interface GenerateTitleCommand extends RpcCommandBase {
  type: "generate_title";
  user_message: string;
  assistant_message: string;
}

interface HealthCommand extends RpcCommandBase {
  type: "health";
}

interface ListSessionsCommand extends RpcCommandBase {
  type: "list_sessions";
}

type RpcCommand =
  | PromptCommand
  | AbortCommand
  | DestroySessionCommand
  | GenerateTitleCommand
  | HealthCommand
  | ListSessionsCommand;

type RawCommand = RpcCommandBase & Record<string, unknown>;

const config = loadConfig();
initAgent(config);

startBackgroundServices().catch((err) => {
  console.error("❌ Background services error:", err);
});

function send(payload: unknown) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function sendResponse(id: RpcId | undefined, command: string, success: boolean, data?: unknown) {
  send({ id, type: "response", command, success, data });
}

function sendError(id: RpcId | undefined, sessionId: string | undefined, message: string) {
  send({ id, type: "error", session_id: sessionId, error: message });
}

function sendDone(id: RpcId | undefined, sessionId: string | undefined) {
  send({ id, type: "done", session_id: sessionId });
}

function normalizeId(id: RpcId | undefined): RpcId {
  return id ?? `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function handlePrompt(command: PromptCommand) {
  const id = normalizeId(command.id);

  if (!command.message?.trim()) {
    sendResponse(id, command.type, false, { error: "message required" });
    sendError(id, command.session_id, "message required");
    sendDone(id, command.session_id);
    return;
  }

  const requestedModel = resolveModel(command.model);
  const modelKey = requestedModel
    ? `${requestedModel.provider}/${requestedModel.id}`
    : `${config.primaryProvider}/${config.primaryModel}`;
  const sessionId = command.session_id || modelKey;

  try {
    const { session } = await getSession(sessionId, {
      userId: command.user_id,
      workspace: command.workspace,
      restricted: command.restricted,
      model: requestedModel,
    });

    if (requestedModel) {
      await session.setModel(requestedModel);
    }

    sendResponse(id, command.type, true, { session_id: sessionId, model: modelKey });

    let finished = false;
    const finish = (error?: string) => {
      if (finished) return;
      finished = true;
      if (error) {
        sendError(id, sessionId, error);
      }
      sendDone(id, sessionId);
      unsub();
    };

    const unsub = session.subscribe((event) => {
      if (finished) return;
      send({ id, type: "session_event", session_id: sessionId, event });
      if (event.type === "agent_end") {
        finish();
      }
    });

    const options = session.isStreaming
      ? { streamingBehavior: command.streaming_behavior || "followUp" as const }
      : undefined;

    session.prompt(command.message, options).catch((err) => {
      finish(err instanceof Error ? err.message : "prompt failed");
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : "prompt failed";
    sendResponse(id, command.type, false, { error });
    sendError(id, sessionId, error);
    sendDone(id, sessionId);
  }
}

async function handleCommand(command: RawCommand) {
  switch (command.type) {
    case "health":
      sendResponse(command.id, command.type, true, {
        status: "ok",
        service: "vm-agent",
        version: "0.2.0-rpc",
        sessions: listSessions().length,
      });
      return;

    case "list_skills":
      sendResponse(command.id, command.type, true, {
        skills: listAvailableSkills(),
      });
      return;

    case "list_sessions":
      sendResponse(command.id, command.type, true, { sessions: listSessions() });
      return;

    case "destroy_session": {
      const sessionId = typeof command.session_id === "string" ? command.session_id : "";
      if (!sessionId) {
        sendResponse(command.id, command.type, false, { error: "session_id required" });
        return;
      }
      const removed = destroySession(sessionId);
      sendResponse(command.id, command.type, removed, { removed });
      return;
    }

    case "abort": {
      const sessionId = typeof command.session_id === "string" ? command.session_id : "";
      if (!sessionId) {
        sendResponse(command.id, command.type, false, { error: "session_id required" });
        return;
      }
      const aborted = await abortSession(sessionId);
      sendResponse(command.id, command.type, aborted, { aborted, session_id: sessionId });
      return;
    }

    case "prompt": {
      if (typeof command.message !== "string") {
        sendResponse(command.id, command.type, false, { error: "message required" });
        return;
      }
      await handlePrompt(command as unknown as PromptCommand);
      return;
    }

    case "generate_title": {
      const userMsg = typeof command.user_message === "string" ? command.user_message : "";
      const assistantMsg = typeof command.assistant_message === "string" ? command.assistant_message : "";
      if (!assistantMsg) {
        sendResponse(command.id, command.type, false, { error: "assistant_message required" });
        return;
      }
      try {
        const title = await generateSessionTitle(userMsg, assistantMsg);
        sendResponse(command.id, command.type, true, { title });
      } catch (err) {
        sendResponse(command.id, command.type, false, {
          error: err instanceof Error ? err.message : "title generation failed",
        });
      }
      return;
    }

    default:
      sendResponse(command.id, command.type, false, {
        error: `unsupported command: ${command.type}`,
      });
  }
}

const rl = createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
  terminal: false,
});

rl.on("line", (line) => {
  const raw = line.trim();
  if (!raw) return;

  let parsed: RawCommand;
  try {
    parsed = JSON.parse(raw) as RawCommand;
  } catch {
    send({ type: "error", error: "invalid_json" });
    return;
  }

  void handleCommand(parsed).catch((err) => {
    sendResponse(parsed.id, parsed.type, false, {
      error: err instanceof Error ? err.message : "command failed",
    });
  });
});

rl.on("close", () => {
  shutdown(0);
});

// Stale session cleanup every 10 minutes (1 hour inactivity threshold)
setInterval(() => {
  const cleaned = cleanupStaleSessions(3600_000);
  if (cleaned > 0) {
    console.error(`[cleanup] cleaned ${cleaned} stale sessions`);
  }
}, 600_000);

function shutdown(code: number) {
  destroyAllSessions();
  process.exit(code);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

process.on("uncaughtException", (err) => {
  console.error("uncaught exception:", err);
});

process.on("unhandledRejection", (reason) => {
  console.error("unhandled rejection:", reason);
});

send({ type: "ready", service: "vm-agent", version: "0.2.0-rpc", skills: listAvailableSkills() });
