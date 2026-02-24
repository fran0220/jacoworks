import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { loadConfig } from "./config.js";
import {
  initAgent,
  getSession,
  abortSession,
  listSessions,
  resolveModel,
  startBackgroundServices,
  getHeartbeatService,
  getCronService,
  destroySession,
  destroyAllSessions,
  cleanupStaleSessions,
} from "./agent.js";

const config = loadConfig();
initAgent(config);
startBackgroundServices().catch((err) =>
  console.error("❌ Background services error:", err),
);

// ─── Helpers ────────────────────────────────────────

function json(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf-8");
}

function checkAuth(req: IncomingMessage, res: ServerResponse): boolean {
  if (!config.gatewayToken) return true; // dev mode: no auth
  const auth = req.headers.authorization;
  if (!auth || auth !== `Bearer ${config.gatewayToken}`) {
    json(res, 401, { error: "unauthorized" });
    return false;
  }
  return true;
}

// ─── SSE Bridge: Pi SDK events → OpenAI SSE format ──

interface ChatRequest {
  messages: Array<{ role: string; content: string }>;
  model?: string;   // e.g. "proxy-claude/claude-sonnet-4-6" or "claude-sonnet-4-6"
  stream?: boolean;
  session_id?: string;
  workspace?: string;      // Project directory for cowork mode
  restricted?: boolean;     // true = only web tools (chat mode), false = full tools (cowork)
}

interface NativeEventRequest {
  message: string;
  model?: string;
  session_id?: string;
  workspace?: string;
  restricted?: boolean;
  streaming_behavior?: "steer" | "followUp";
}

async function handleChat(req: IncomingMessage, res: ServerResponse) {
  if (!checkAuth(req, res)) return;

  let body: ChatRequest;
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    json(res, 400, { error: "invalid JSON" });
    return;
  }

  const messages = body.messages;
  if (!messages?.length) {
    json(res, 400, { error: "messages required" });
    return;
  }

  // Extract last user message
  const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
  if (!lastUserMsg) {
    json(res, 400, { error: "no user message found" });
    return;
  }

  // 按 model 字段分 session，不同模型不共享上下文
  const requestedModel = resolveModel(body.model);
  const modelKey = requestedModel
    ? `${requestedModel.provider}/${requestedModel.id}`
    : `${config.primaryProvider}/${config.primaryModel}`;
  const sessionId = body.session_id || modelKey;
  const isStream = body.stream !== false; // default: true

  try {
    const { session } = await getSession(sessionId, {
      workspace: body.workspace,
      restricted: body.restricted,
    });

    // 如果请求指定了模型，切换
    if (requestedModel) {
      await session.setModel(requestedModel);
    }

    if (isStream) {
      // SSE streaming response
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });

      // Collect text for tool-call turns (agent does multiple turns)
      const unsub = session.subscribe((event) => {
        if (
          event.type === "message_update" &&
          event.assistantMessageEvent.type === "text_delta"
        ) {
          const chunk = {
            id: `chatcmpl-${Date.now()}`,
            object: "chat.completion.chunk",
            created: Math.floor(Date.now() / 1000),
            model: modelKey,
            choices: [
              {
                index: 0,
                delta: { content: event.assistantMessageEvent.delta },
                finish_reason: null,
              },
            ],
          };
          res.write(`data: ${JSON.stringify(chunk)}\n\n`);
        }

        if (event.type === "tool_execution_start") {
          res.write(`: tool ${event.toolName} started\n\n`);
        }

        if (event.type === "tool_execution_end") {
          const status = event.isError ? "error" : "completed";
          res.write(`: tool ${event.toolName} ${status}\n\n`);
        }

        if (event.type === "tool_execution_update") {
          res.write(`: tool ${event.toolName} progress\n\n`);
        }

        if (event.type === "turn_start") {
          res.write(`: turn started\n\n`);
        }

        if (event.type === "turn_end") {
          res.write(`: turn ended\n\n`);
        }

        if (event.type === "auto_compaction_start") {
          res.write(`: compaction started (reason: ${event.reason})\n\n`);
        }

        if (event.type === "auto_compaction_end") {
          res.write(`: compaction ended (aborted: ${event.aborted}, willRetry: ${event.willRetry})\n\n`);
        }

        if (event.type === "auto_retry_start") {
          res.write(`: retry ${event.attempt}/${event.maxAttempts} (delay: ${event.delayMs}ms)\n\n`);
        }

        if (event.type === "auto_retry_end") {
          res.write(`: retry ended (success: ${event.success}, attempt: ${event.attempt})\n\n`);
        }

        if (event.type === "agent_end") {
          // Send final chunk with finish_reason
          const finalChunk = {
            id: `chatcmpl-${Date.now()}`,
            object: "chat.completion.chunk",
            created: Math.floor(Date.now() / 1000),
            model: modelKey,
            choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
          };
          res.write(`data: ${JSON.stringify(finalChunk)}\n\n`);
          res.write("data: [DONE]\n\n");
          res.end();
          unsub();
        }
      });

      // Handle client disconnect
      req.on("close", () => {
        unsub();
        if (session.isStreaming) {
          session.abort().catch(() => {});
        }
      });

      await session.prompt(lastUserMsg.content);
    } else {
      // Non-streaming: collect full response
      let fullText = "";

      await new Promise<void>((resolve, reject) => {
        const unsub = session.subscribe((event) => {
          if (
            event.type === "message_update" &&
            event.assistantMessageEvent.type === "text_delta"
          ) {
            fullText += event.assistantMessageEvent.delta;
          }
          if (event.type === "agent_end") {
            unsub();
            resolve();
          }
        });

        session.prompt(lastUserMsg.content).catch((err) => {
          unsub();
          reject(err);
        });
      });

      json(res, 200, {
        id: `chatcmpl-${Date.now()}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: modelKey,
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: fullText },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      });
    }
  } catch (err) {
    console.error("❌ Chat error:", err);
    if (!res.headersSent) {
      json(res, 500, {
        error: err instanceof Error ? err.message : "internal error",
      });
    }
  }
}

async function handleNativeEventStream(req: IncomingMessage, res: ServerResponse) {
  if (!checkAuth(req, res)) return;

  let body: NativeEventRequest;
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    json(res, 400, { error: "invalid JSON" });
    return;
  }

  if (!body.message?.trim()) {
    json(res, 400, { error: "message required" });
    return;
  }

  const requestedModel = resolveModel(body.model);
  const modelKey = requestedModel
    ? `${requestedModel.provider}/${requestedModel.id}`
    : `${config.primaryProvider}/${config.primaryModel}`;
  const sessionId = body.session_id || modelKey;

  try {
    const { session } = await getSession(sessionId, {
      workspace: body.workspace,
      restricted: body.restricted,
    });

    if (requestedModel) {
      await session.setModel(requestedModel);
    }

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    let closed = false;
    const sendEvent = (payload: unknown) => {
      if (!closed) {
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
      }
    };

    const unsub = session.subscribe((event) => {
      sendEvent({ type: "session_event", session_id: sessionId, event });
      if (event.type === "agent_end") {
        sendEvent({ type: "done", session_id: sessionId });
        closed = true;
        res.end();
        unsub();
      }
    });

    req.on("close", () => {
      if (closed) return;
      closed = true;
      unsub();
      if (session.isStreaming) {
        session.abort().catch(() => {});
      }
    });

    const options = session.isStreaming
      ? { streamingBehavior: body.streaming_behavior || "followUp" as const }
      : undefined;
    await session.prompt(body.message, options);
  } catch (err) {
    console.error("❌ Native stream error:", err);
    if (!res.headersSent) {
      json(res, 500, {
        error: err instanceof Error ? err.message : "internal error",
      });
    }
  }
}

// ─── HTTP Router ────────────────────────────────────

const server = createServer(async (req, res) => {
  const method = req.method?.toUpperCase();
  const url = req.url?.split("?")[0];

  // CORS headers for browser dev mode
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.setHeader("Access-Control-Allow-Credentials", "true");
  }
  if (method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    // Health check
    if (url === "/health" && method === "GET") {
      json(res, 200, {
        status: "ok",
        service: "vm-agent",
        version: "0.1.0",
        sessions: listSessions().length,
      });
      return;
    }

    // Chat completions (OpenAI-compatible)
    if (url === "/v1/chat/completions" && method === "POST") {
      await handleChat(req, res);
      return;
    }

    // Native Pi session events (recommended)
    if (url === "/v1/chat/events" && method === "POST") {
      await handleNativeEventStream(req, res);
      return;
    }

    // Session list (debug)
    if (url === "/api/sessions" && method === "GET") {
      if (!checkAuth(req, res)) return;
      json(res, 200, { sessions: listSessions() });
      return;
    }

    // DELETE /api/sessions/:id
    if (url?.startsWith("/api/sessions/") && method === "DELETE") {
      if (!checkAuth(req, res)) return;
      const sessionId = url.slice("/api/sessions/".length);
      const removed = destroySession(sessionId);
      json(res, removed ? 200 : 404, { removed });
      return;
    }

    // Abort a running session turn
    if (url?.startsWith("/api/sessions/") && url.endsWith("/abort") && method === "POST") {
      if (!checkAuth(req, res)) return;
      const sessionId = url.slice("/api/sessions/".length, -"/abort".length);
      const aborted = await abortSession(sessionId);
      json(res, aborted ? 200 : 404, { aborted });
      return;
    }

    // Heartbeat status
    if (url === "/api/heartbeat/status" && method === "GET") {
      if (!checkAuth(req, res)) return;
      const hb = getHeartbeatService();
      json(res, 200, hb ? hb.getStatus() : { running: false, lastRun: null, nextRun: null });
      return;
    }

    // Heartbeat manual trigger
    if (url === "/api/heartbeat/trigger" && method === "POST") {
      if (!checkAuth(req, res)) return;
      const hb = getHeartbeatService();
      if (!hb) {
        json(res, 404, { error: "heartbeat not enabled" });
        return;
      }
      hb.stop();
      hb.start();
      json(res, 200, { triggered: true });
      return;
    }

    // Cron: list jobs
    if (url === "/api/cron" && method === "GET") {
      if (!checkAuth(req, res)) return;
      const cron = getCronService();
      json(res, 200, { jobs: cron ? cron.listJobs() : [] });
      return;
    }

    // Cron: add job
    if (url === "/api/cron" && method === "POST") {
      if (!checkAuth(req, res)) return;
      const cron = getCronService();
      if (!cron) {
        json(res, 404, { error: "cron not enabled" });
        return;
      }
      try {
        const body = JSON.parse(await readBody(req));
        if (!body.schedule || !body.prompt) {
          json(res, 400, { error: "schedule and prompt required" });
          return;
        }
        const job = cron.addJob(body.schedule, body.prompt);
        json(res, 201, job);
      } catch {
        json(res, 400, { error: "invalid JSON" });
      }
      return;
    }

    // Cron: delete job
    if (url?.startsWith("/api/cron/") && method === "DELETE") {
      if (!checkAuth(req, res)) return;
      const cron = getCronService();
      if (!cron) {
        json(res, 404, { error: "cron not enabled" });
        return;
      }
      const jobId = url.slice("/api/cron/".length);
      const removed = cron.removeJob(jobId);
      json(res, removed ? 200 : 404, { removed });
      return;
    }

    // 404
    json(res, 404, { error: "not found" });
  } catch (err) {
    console.error("❌ Server error:", err);
    if (!res.headersSent) {
      json(res, 500, { error: "internal server error" });
    }
  }
});

server.listen(config.port, "0.0.0.0", () => {
  console.log(`\n[startup] vm-agent running on http://0.0.0.0:${config.port}`);
  console.log(`   POST /v1/chat/completions   — Chat (OpenAI SSE)`);
  console.log(`   POST /v1/chat/events        — Chat (Native Pi events SSE)`);
  console.log(`   GET  /health                — Health check`);
  console.log(`   GET  /api/sessions          — List sessions`);
  console.log(`   DELETE /api/sessions/:id     — Destroy session`);
  console.log(`   POST /api/sessions/:id/abort — Abort session run`);
  console.log(`   GET  /api/heartbeat/status  — Heartbeat status`);
  console.log(`   POST /api/heartbeat/trigger — Trigger heartbeat`);
  console.log(`   GET  /api/cron              — List cron jobs`);
  console.log(`   POST /api/cron              — Add cron job`);
  console.log(`   DELETE /api/cron/:id         — Remove cron job\n`);
});

// Stale session cleanup every 10 minutes (1 hour inactivity threshold)
setInterval(() => {
  const cleaned = cleanupStaleSessions(3600_000);
  if (cleaned > 0) console.log(`[cleanup] cleaned ${cleaned} stale sessions`);
}, 600_000);

// Graceful shutdown
function shutdown() {
  console.log("\n[shutdown] shutting down...");
  const hb = getHeartbeatService();
  if (hb) hb.stop();
  const cron = getCronService();
  if (cron) cron.stop();
  destroyAllSessions();
  server.close(() => {
    console.log("[shutdown] server closed");
    process.exit(0);
  });
  // Force exit after 5s
  setTimeout(() => process.exit(1), 5000);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
