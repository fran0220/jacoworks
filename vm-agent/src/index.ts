import { createInterface } from "node:readline";
import { loadConfig } from "./config.js";
import {
  initAgent,
  startBackgroundServices,
  destroyAllSessions,
  cleanupStaleSessions,
  listAvailableSkills,
  agentEvents,
} from "./agent.js";
import { handleCommand, type RawCommand } from "./transport/handler.js";
import type { TransportSender } from "./transport/types.js";

const config = loadConfig();
initAgent(config);

const sender: TransportSender = {
  send(payload: unknown) {
    process.stdout.write(`${JSON.stringify(payload)}\n`);
  },
};

// Forward cron result events to desktop via stdout transport
agentEvents.on("cron_result", (event) => {
  sender.send({ type: "cron_result", ...event });
});

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
    sender.send({ type: "error", error: "invalid_json" });
    return;
  }

  void handleCommand(config, sender, parsed).catch((err) => {
    sender.send({
      id: parsed.id,
      type: "response",
      command: parsed.type,
      success: false,
      data: { error: err instanceof Error ? err.message : "command failed" },
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

// 等待后台服务 (cron, heartbeat) 初始化完成后再发 ready，
// 确保首个 prompt 到达时 cronService 等已注册为 extension。
startBackgroundServices()
  .catch((err) => {
    console.error("❌ Background services error:", err);
  })
  .finally(() => {
    sender.send({ type: "ready", service: "vm-agent", version: "0.2.0-rpc", skills: listAvailableSkills() });
  });
