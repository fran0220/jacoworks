import { spawn } from "node:child_process";
import { Type, type Static } from "@sinclair/typebox";
import type { ExtensionFactory, ToolDefinition } from "@mariozechner/pi-coding-agent";
import { getEnrichedEnv } from "../lib/env-enrichment.js";

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_BYTES = 200 * 1024;

const BashParams = Type.Object({
  command: Type.String({ description: "Shell command to execute" }),
  timeout_ms: Type.Optional(
    Type.Number({
      description: "Command timeout in milliseconds (default 30000, max 120000)",
      minimum: 1,
    }),
  ),
  timeout: Type.Optional(
    Type.Number({
      description: "Legacy timeout in seconds (converted to milliseconds)",
      minimum: 1,
    }),
  ),
  cwd: Type.Optional(Type.String({ description: "Working directory for command execution" })),
});

interface FormattedExecResult {
  content: Array<{ type: "text"; text: string }>;
  details: {
    transport: "container-local";
    exitCode: number | null;
    killed: boolean;
    timeoutMs: number;
  };
}

function clampTimeoutMs(params: Static<typeof BashParams>): number {
  const raw = Number.isFinite(params.timeout_ms)
    ? Number(params.timeout_ms)
    : Number.isFinite(params.timeout)
      ? Number(params.timeout) * 1000
      : DEFAULT_TIMEOUT_MS;
  const normalized = Math.floor(raw);
  if (!Number.isFinite(normalized) || normalized <= 0) return DEFAULT_TIMEOUT_MS;
  return Math.min(MAX_TIMEOUT_MS, normalized);
}

function truncateOutput(text: string): string {
  if (Buffer.byteLength(text, "utf-8") <= MAX_OUTPUT_BYTES) return text;
  let truncated = text;
  while (Buffer.byteLength(truncated, "utf-8") > MAX_OUTPUT_BYTES) {
    truncated = truncated.slice(0, truncated.length - 1024);
  }
  return `${truncated}\n...(output truncated to 200KB)`;
}

function renderOutput(stdout: string, stderr: string, exitCode: number | null, killed: boolean): string {
  const parts: string[] = [];
  if (stdout.trim()) parts.push(stdout.trim());
  if (stderr.trim()) parts.push(`STDERR:\n${stderr.trim()}`);
  if (killed) parts.push("Process killed (timeout or cancelled).");
  if (exitCode !== null && exitCode !== 0) parts.push(`Exit code: ${exitCode}`);
  return truncateOutput(parts.length > 0 ? parts.join("\n\n") : "(no output)");
}

function formatExecResult(stdout: string, stderr: string, exitCode: number | null, killed: boolean, timeoutMs: number): FormattedExecResult {
  return {
    content: [
      {
        type: "text",
        text: renderOutput(stdout, stderr, exitCode, killed),
      },
    ],
    details: {
      transport: "container-local",
      exitCode,
      killed,
      timeoutMs,
    },
  };
}

function runBashInContainer(
  command: string,
  cwd: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<FormattedExecResult> {
  return new Promise((resolveResult) => {
    // Enrich environment with user tools (nvm, pyenv, virtualenv, etc.)
    const enriched = getEnrichedEnv(cwd);
    const env = {
      ...process.env,
      PATH: enriched.PATH,
      ...enriched.extraEnv,
    };

    const child = spawn("bash", ["-c", command], {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let killed = false;

    const timer = setTimeout(() => {
      killed = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    const onAbort = () => {
      killed = true;
      clearTimeout(timer);
      child.kill("SIGKILL");
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf-8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf-8");
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolveResult(formatExecResult(stdout, stderr, code, killed, timeoutMs));
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolveResult({
        content: [{ type: "text", text: `Failed to spawn bash: ${err.message}` }],
        details: {
          transport: "container-local",
          exitCode: null,
          killed,
          timeoutMs,
        },
      });
    });
  });
}

export function createBashExtension(): ExtensionFactory {
  return (pi) => {
    const bashTool: ToolDefinition<typeof BashParams> = {
      name: "bash",
      label: "Bash",
      description: "Execute shell commands inside the vm-agent Linux container.",
      parameters: BashParams,
      execute: async (_toolCallId, params: Static<typeof BashParams>, signal?: AbortSignal) => {
        const timeoutMs = clampTimeoutMs(params);
        const cwd = params.cwd?.trim() || process.cwd();
        return runBashInContainer(params.command, cwd, timeoutMs, signal);
      },
    };

    pi.registerTool(bashTool);
  };
}
