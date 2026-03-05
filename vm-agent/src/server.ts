import { loadConfig } from "./config.js";
import {
  initAgent,
  startBackgroundServices,
  destroyAllSessions,
  cleanupStaleSessions,
  listAvailableSkills,
} from "./agent.js";
import { handleCommand, type RawCommand } from "./transport/handler.js";
import type { TransportSender } from "./transport/types.js";

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
      console.error(`[ws] client connected`);
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

      const sender: TransportSender = {
        send(payload: unknown) {
          ws.send(JSON.stringify(payload));
        },
      };

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
      console.error(`[ws] client disconnected (code=${code}, reason=${reason})`);
    },
  },
});

console.error(`🚀 vm-agent server listening on ws://0.0.0.0:${server.port}`);
console.error(`   Health: http://0.0.0.0:${server.port}/health`);

// Wait for background services (cron, heartbeat) to initialize before marking ready,
// ensuring cronService is registered as extension before the first prompt arrives.
startBackgroundServices()
  .catch((err) => {
    console.error("❌ Background services error:", err);
  })
  .finally(() => {
    servicesReady = true;
    console.error(`   Skills: ${listAvailableSkills().length} loaded`);
    console.error(`   ✅ Background services ready`);
  });

// Stale session cleanup every 10 minutes (1 hour inactivity threshold)
setInterval(() => {
  const cleaned = cleanupStaleSessions(3600_000);
  if (cleaned > 0) {
    console.error(`[cleanup] cleaned ${cleaned} stale sessions`);
  }
}, 600_000);

function shutdown() {
  console.error("[ws] shutting down...");
  destroyAllSessions();
  server.stop();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

process.on("uncaughtException", (err) => {
  console.error("uncaught exception:", err);
});

process.on("unhandledRejection", (reason) => {
  console.error("unhandled rejection:", reason);
});
