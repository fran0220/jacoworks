import { readFile } from "node:fs/promises";
import { join } from "node:path";

export interface HeartbeatConfig {
  enabled: boolean;
  intervalMs: number;
  agentHomeDir: string;
  activeHours?: { start: string; end: string };
  prompt?: string;
}

export interface HeartbeatStatus {
  running: boolean;
  lastRun: number | null;
  nextRun: number | null;
}

export interface HeartbeatService {
  start(): void;
  stop(): void;
  getStatus(): HeartbeatStatus;
}

function isWithinActiveHours(activeHours?: { start: string; end: string }): boolean {
  if (!activeHours) return true;

  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  const [startH, startM] = activeHours.start.split(":").map(Number);
  const [endH, endM] = activeHours.end.split(":").map(Number);
  const startMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;

  if (startMinutes <= endMinutes) {
    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  }
  // Wraps midnight (e.g. 22:00 - 06:00)
  return currentMinutes >= startMinutes || currentMinutes < endMinutes;
}

async function loadHeartbeatPrompt(agentHomeDir: string, customPrompt?: string): Promise<string | null> {
  if (customPrompt) return customPrompt;

  try {
    const content = await readFile(join(agentHomeDir, "HEARTBEAT.md"), "utf-8");
    return content.trim() || null;
  } catch {
    return null;
  }
}

export function createHeartbeatService(
  config: HeartbeatConfig,
  promptFn: (prompt: string) => Promise<string>,
): HeartbeatService {
  let timer: ReturnType<typeof setInterval> | null = null;
  let lastRun: number | null = null;
  let startTime: number | null = null;
  let ticking = false;

  async function tick() {
    if (ticking) return;
    if (!isWithinActiveHours(config.activeHours)) return;
    ticking = true;

    const prompt = await loadHeartbeatPrompt(config.agentHomeDir, config.prompt);
    if (!prompt) { ticking = false; return; }

    lastRun = Date.now();
    try {
      const result = await promptFn(prompt);
      if (!result.includes("HEARTBEAT_OK")) {
        console.log(`💓 Heartbeat result: ${result.slice(0, 200)}`);
      }
    } catch (err) {
      console.error("💓 Heartbeat error:", err instanceof Error ? err.message : err);
    } finally {
      ticking = false;
    }
  }

  return {
    start() {
      if (!config.enabled || timer) return;
      startTime = Date.now();
      timer = setInterval(tick, config.intervalMs);
      console.log(`💓 Heartbeat started (interval: ${config.intervalMs}ms)`);
    },

    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
        startTime = null;
        console.log("💓 Heartbeat stopped");
      }
    },

    getStatus(): HeartbeatStatus {
      return {
        running: timer !== null,
        lastRun,
        nextRun: timer && startTime
          ? (lastRun ?? startTime) + config.intervalMs
          : null,
      };
    },
  };
}
