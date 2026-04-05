import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const PORT = Number(process.env.PORT || 18789);
const TOKEN = process.env.WS_WRAPPER_TOKEN || "";
const SESSION_IDLE_MS = 30 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_CWD = process.env.PI_WORKSPACE_DIR || "/data/workspace";
const AGENT_PRESETS_PATH = process.env.PI_AGENT_PRESETS_PATH || "/home/node/.pi/agent/agents.json";
const TEAM_TEMPLATES_DIR = process.env.PI_TEAM_TEMPLATES_DIR || "/home/node/.pi/agent/team-templates";
const BOOTSTRAP_COMMAND_DELAY_MS = 350;

type ClientSocket = ServerWebSocket<undefined>;
type PiProcess = ReturnType<typeof Bun.spawn>;

interface SessionState {
  bootstrapped: boolean;
  client: ClientSocket | null;
  id: string;
  initPromise: Promise<void> | null;
  lastAccess: number;
  pendingPrompts: string[];
  process: PiProcess;
  ready: boolean;
  stdin: NonNullable<PiProcess["stdin"]>;
  stopping: boolean;
  suppressExitErrorsUntil: number;
  team: TeamConfig | null;
}

interface WrapperCommand {
  message?: string;
  session_id?: string;
  type?: string;
}

interface AgentPreset {
  id?: string;
  workspaceKey?: string;
  systemPrompt?: string | null;
}

interface TeamConfig {
  bootstrapCommands?: string[];
  id: string;
  leaderSystemPrompt?: string | null;
}

const sessions = new Map<string, SessionState>();

function getAgentWorkspaceKey(sessionId: string): string | null {
  const normalized = sessionId.trim();
  if (normalized === "agent:default:main") {
    return "agent:default";
  }
  if (/^agent:[^:]+$/.test(normalized)) {
    return normalized;
  }
  if (/^agent:[^:]+:t-[^:]+$/.test(normalized)) {
    return normalized.replace(/:t-[^:]+$/, "");
  }
  return null;
}

function loadAgentPresets(): AgentPreset[] {
  try {
    const raw = readFileSync(AGENT_PRESETS_PATH, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as AgentPreset[]) : [];
  } catch {
    return [];
  }
}

function getAgentPrompt(sessionId: string): string | null {
  const workspaceKey = getAgentWorkspaceKey(sessionId);
  if (!workspaceKey) return null;

  const preset = loadAgentPresets().find((item) => item.workspaceKey?.trim() === workspaceKey);
  const prompt = typeof preset?.systemPrompt === "string" ? preset.systemPrompt.trim() : "";
  return prompt || null;
}

function getTeamTemplateID(sessionId: string): string | null {
  const match = sessionId.trim().match(/^team:([^:]+)(?::|$)/);
  return match ? match[1] : null;
}

function getTeamConfig(sessionId: string): TeamConfig | null {
  const teamTemplateID = getTeamTemplateID(sessionId);
  if (!teamTemplateID) return null;

  try {
    for (const fileName of readdirSync(TEAM_TEMPLATES_DIR)) {
      if (!fileName.endsWith(".json")) continue;
      const raw = readFileSync(join(TEAM_TEMPLATES_DIR, fileName), "utf8");
      const parsed = JSON.parse(raw) as TeamConfig;
      if (parsed.id === teamTemplateID) {
        return parsed;
      }
    }
  } catch {
    return null;
  }

  return null;
}

function send(ws: ClientSocket, payload: Record<string, unknown>) {
  try {
    ws.send(JSON.stringify(payload));
  } catch {
    // Ignore transient socket write failures; the next prompt can reattach ownership.
  }
}

function sendSessionError(session: SessionState, error: string) {
  if (!session.client) return;
  send(session.client, { type: "session_error", session_id: session.id, error });
}

function touch(session: SessionState) {
  session.lastAccess = Date.now();
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function writeRPCCommand(session: SessionState, payload: Record<string, unknown>) {
  session.stdin.write(`${JSON.stringify(payload)}\n`);
}

async function ensureSessionInitialized(session: SessionState) {
  if (session.initPromise) {
    await session.initPromise;
    return;
  }

  session.initPromise = (async () => {
    if (session.team && !session.bootstrapped) {
      session.bootstrapped = true;
      for (const command of session.team.bootstrapCommands || []) {
        writeRPCCommand(session, { type: "prompt", message: command });
        await sleep(BOOTSTRAP_COMMAND_DELAY_MS);
      }
    }

    if (session.pendingPrompts.length === 0) {
      return;
    }

    const queuedPrompts = [...session.pendingPrompts];
    session.pendingPrompts = [];
    for (const message of queuedPrompts) {
      writeRPCCommand(session, { type: "prompt", message });
    }
  })().finally(() => {
    session.initPromise = null;
  });

  await session.initPromise;
}

function queuePrompt(session: SessionState, message: string) {
  session.pendingPrompts.push(message);
  void ensureSessionInitialized(session).catch((error) => {
    const text = error instanceof Error ? error.message : "failed to initialize session";
    sendSessionError(session, text);
    session.pendingPrompts = [];
  });
}

function terminateSession(session: SessionState, reason: "idle" | "shutdown") {
  session.stopping = true;
  session.suppressExitErrorsUntil = Number.POSITIVE_INFINITY;
  sessions.delete(session.id);
  try {
    process.kill(session.process.pid, "SIGTERM");
  } catch {
    // Process already exited.
  }
  if (reason === "idle") {
    console.log(`[pi-ws-wrapper] cleaned idle session ${session.id}`);
  }
}

function handleProcessExit(session: SessionState, exitCode: number | null, error?: Error | null) {
  if (sessions.get(session.id) === session) {
    sessions.delete(session.id);
  }

  const aborted = session.stopping || session.suppressExitErrorsUntil > Date.now() || exitCode === 130;
  if (!aborted) {
    const suffix = error?.message ? `: ${error.message}` : exitCode == null ? "" : ` (exit ${exitCode})`;
    sendSessionError(session, `pi process exited unexpectedly${suffix}`);
  }

  if (!session.stopping) {
    console.error(`[pi-ws-wrapper] session ${session.id} exited`, { exitCode, error: error?.message });
  }
}

async function pumpLines(
  stream: ReadableStream<Uint8Array> | null | undefined,
  onLine: (line: string) => void,
) {
  if (!stream) return;

  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      for (;;) {
        const newline = buffer.indexOf("\n");
        if (newline === -1) break;
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) onLine(line);
      }
    }

    buffer += decoder.decode();
    const line = buffer.trim();
    if (line) onLine(line);
  } finally {
    reader.releaseLock();
  }
}

function spawnSession(sessionId: string, ws: ClientSocket): SessionState {
  const teamConfig = getTeamConfig(sessionId);
  if (sessionId.startsWith("team:") && !teamConfig) {
    throw new Error(`team template not found for session ${sessionId}`);
  }

  const args = ["pi", "--mode", "rpc"];
  const systemPrompt = teamConfig?.leaderSystemPrompt?.trim() || getAgentPrompt(sessionId);
  if (systemPrompt) {
    args.push("--system-prompt", systemPrompt);
  }

  const processRef = Bun.spawn(args, {
    cwd: DEFAULT_CWD,
    env: {
      ...process.env,
      HOME: process.env.HOME || "/home/node",
      LLM_PROXY_KEY: process.env.LLM_PROXY_KEY || "",
    },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    onExit(_proc, exitCode, _signalCode, error) {
      const session = sessions.get(sessionId);
      if (session) {
        handleProcessExit(session, exitCode, error);
        return;
      }
      handleProcessExit(state, exitCode, error);
    },
  });

  if (!processRef.stdin) {
    throw new Error("pi process stdin is unavailable");
  }

  const state: SessionState = {
    bootstrapped: !teamConfig,
    client: ws,
    id: sessionId,
    initPromise: null,
    lastAccess: Date.now(),
    pendingPrompts: [],
    process: processRef,
    ready: false,
    stdin: processRef.stdin,
    stopping: false,
    suppressExitErrorsUntil: 0,
    team: teamConfig,
  };

  sessions.set(sessionId, state);

  void pumpLines(processRef.stdout, (line) => {
    touch(state);

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(line) as Record<string, unknown>;
    } catch {
      sendSessionError(state, `invalid JSON from pi stdout: ${line}`);
      return;
    }

    if (!state.ready) {
      state.ready = true;
      if (state.client) {
        send(state.client, { type: "session_ready", session_id: state.id });
      }
    }

    if (state.client) {
      send(state.client, { ...payload, session_id: state.id });
    }
  });

  void pumpLines(processRef.stderr, (line) => {
    console.error(`[pi-ws-wrapper:${sessionId}] ${line}`);
  });

  return state;
}

function getOrCreateSession(sessionId: string, ws: ClientSocket) {
  const existing = sessions.get(sessionId);
  if (existing) {
    existing.client = ws;
    touch(existing);
    return existing;
  }
  return spawnSession(sessionId, ws);
}

const server = Bun.serve({
  port: PORT,
  fetch(req, serverInstance) {
    const url = new URL(req.url);

    if (url.pathname === "/health") {
      return Response.json({ status: "ok", sessions: sessions.size });
    }

    if (url.pathname !== "/ws") {
      return new Response("Not Found", { status: 404 });
    }

    if (!TOKEN) {
      return new Response("WS_WRAPPER_TOKEN is not configured", { status: 503 });
    }

    if (url.searchParams.get("token") !== TOKEN) {
      return new Response("Unauthorized", { status: 401 });
    }

    return serverInstance.upgrade(req) ? undefined : new Response("WebSocket upgrade failed", { status: 400 });
  },
  websocket: {
    message(ws, rawMessage) {
      const raw = typeof rawMessage === "string" ? rawMessage : new TextDecoder().decode(rawMessage);
      let command: WrapperCommand;

      try {
        command = JSON.parse(raw) as WrapperCommand;
      } catch {
        send(ws, { type: "session_error", error: "invalid_json" });
        return;
      }

      const sessionId = command.session_id?.trim();
      if (!sessionId) {
        send(ws, { type: "session_error", error: "session_id is required" });
        return;
      }

      if (command.type === "abort") {
        const session = sessions.get(sessionId);
        if (!session) {
          send(ws, { type: "session_error", session_id: sessionId, error: "session not found" });
          return;
        }

        session.client = ws;
        session.pendingPrompts = [];
        touch(session);
        session.suppressExitErrorsUntil = Date.now() + 5_000;
        try {
          writeRPCCommand(session, { type: "abort" });
        } catch {
          try {
            process.kill(session.process.pid, "SIGINT");
          } catch (error) {
            sendSessionError(session, error instanceof Error ? error.message : "failed to abort session");
          }
        }
        return;
      }

      if (command.type !== "prompt" || typeof command.message !== "string") {
        send(ws, { type: "session_error", session_id: sessionId, error: "unsupported command" });
        return;
      }

      try {
        const session = getOrCreateSession(sessionId, ws);
        queuePrompt(session, command.message);
        touch(session);
      } catch (error) {
        const message = error instanceof Error ? error.message : "failed to start pi session";
        send(ws, { type: "session_error", session_id: sessionId, error: message });
      }
    },
    close(ws) {
      for (const session of sessions.values()) {
        if (session.client === ws) {
          session.client = null;
        }
      }
    },
  },
});

const cleanupTimer = setInterval(() => {
  const cutoff = Date.now() - SESSION_IDLE_MS;
  for (const session of sessions.values()) {
    if (session.lastAccess < cutoff) {
      terminateSession(session, "idle");
    }
  }
}, CLEANUP_INTERVAL_MS);

function shutdown() {
  clearInterval(cleanupTimer);
  for (const session of [...sessions.values()]) {
    terminateSession(session, "shutdown");
  }
  server.stop();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

console.log(`[pi-ws-wrapper] listening on http://0.0.0.0:${server.port}`);
