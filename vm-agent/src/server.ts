import { loadConfig } from "./config.js";
import {
  initAgent,
  startBackgroundServices,
  destroyAllSessions,
  cleanupStaleSessions,
  listAvailableSkills,
  agentEvents,
} from "./agent.js";
import { handleCommand, clearAllInFlight, type RawCommand } from "./transport/handler.js";
import type { TransportSender } from "./transport/types.js";
import { log } from "./lib/logger.js";

const config = loadConfig();
initAgent(config);

// Track background services readiness to avoid race with cronService
let servicesReady = false;

const server = Bun.serve({
  port: config.port,

  fetch(req, server) {
    const url = new URL(req.url);

    // Health endpoint
    if (url.pathname === "/health" && req.method === "GET") {
      return Response.json({ status: "ok", service: "vm-agent", version: "0.2.0-ws", ready: servicesReady });
    }

    // WebSocket upgrade
    if (url.pathname === "/ws" || url.pathname === "/") {
      const token = url.searchParams.get("token");
      if (config.gatewayToken && token !== config.gatewayToken) {
        return new Response("Unauthorized", { status: 401 });
      }
      const upgraded = server.upgrade(req);
      if (!upgraded) {
        return new Response("WebSocket upgrade failed", { status: 400 });
      }
      return undefined;
    }

    return new Response("Not Found", { status: 404 });
  },

  websocket: {
    open(ws) {
      log.info("ws client connected");
      const sender: TransportSender = {
        send(payload: unknown) {
          ws.send(JSON.stringify(payload));
        },
      };
      (ws as any).__sender = sender;

      // Forward cron result events to the connected desktop client via WS.
      const onCronResult = (event: Record<string, unknown>) => {
        ws.send(JSON.stringify({ type: "cron_result", ...event }));
      };
      agentEvents.on("cron_result", onCronResult);
      (ws as any).__cronResultListener = onCronResult;
    },

    message(ws, message) {
      const raw = typeof message === "string" ? message : new TextDecoder().decode(message);
      if (!raw.trim()) return;

      let parsed: RawCommand;
      try {
        parsed = JSON.parse(raw) as RawCommand;
      } catch {
        ws.send(JSON.stringify({ type: "error", error: "invalid_json" }));
        return;
      }

      const sender = (ws as any).__sender as TransportSender;

      void handleCommand(config, sender, parsed).catch((err) => {
        sender.send({
          id: parsed.id,
          type: "response",
          command: parsed.type,
          success: false,
          data: { error: err instanceof Error ? err.message : "command failed" },
        });
      });
    },

    close(ws, code, reason) {
      log.info("ws client disconnected", { code, reason: String(reason) });
      clearAllInFlight();
      const onCronResult = (ws as any).__cronResultListener;
      if (onCronResult) agentEvents.off("cron_result", onCronResult);
    },
  },
});

log.info("server listening", { port: server.port, health: `http://0.0.0.0:${server.port}/health` });

// Wait for background services (cron, heartbeat) to initialize before marking ready,
// ensuring cronService is registered as extension before the first prompt arrives.
startBackgroundServices()
  .catch((err) => {
    log.error("background services error", { error: err instanceof Error ? err.message : String(err) });
  })
  .finally(() => {
    servicesReady = true;
    log.info("background services ready", { skills: listAvailableSkills().length });
  });

// Stale session cleanup every 10 minutes (1 hour inactivity threshold)
setInterval(() => {
  const cleaned = cleanupStaleSessions(3600_000);
  if (cleaned > 0) {
    log.info("cleaned stale sessions", { count: cleaned });
  }
}, 600_000);

function shutdown() {
  log.info("shutting down");
  destroyAllSessions();
  server.stop();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

process.on("uncaughtException", (err) => {
  log.error("uncaught exception", { error: err instanceof Error ? err.message : String(err) });
});

process.on("unhandledRejection", (reason) => {
  log.error("unhandled rejection", { error: reason instanceof Error ? reason.message : String(reason) });
});
