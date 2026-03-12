import { spawn } from "node:child_process";
import { Type, type Static } from "@sinclair/typebox";
import type { ExtensionFactory, ToolDefinition } from "@mariozechner/pi-coding-agent";

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_TIMEOUT_MS = 300_000;
const MAX_OUTPUT_BYTES = 200 * 1024;

const PythonParams = Type.Object({
  code: Type.String({ description: "Python code to execute" }),
  timeout_ms: Type.Optional(
    Type.Number({
      description: "Execution timeout in milliseconds (default 60000, max 300000)",
      minimum: 1,
    }),
  ),
  cwd: Type.Optional(Type.String({ description: "Working directory" })),
});

/** Python command name — guaranteed on PATH by bundled runtimes. */
const PYTHON_CMD = process.platform === "win32" ? "python" : "python3";

function clampTimeout(params: Static<typeof PythonParams>): number {
  const raw = Number.isFinite(params.timeout_ms) ? Number(params.timeout_ms) : DEFAULT_TIMEOUT_MS;
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

function runPython(
  code: string,
  cwd: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<{ content: Array<{ type: "text"; text: string }>; details: Record<string, unknown> }> {
  return new Promise((resolve) => {
    const child = spawn(PYTHON_CMD, ["-u", "-c", code], {
      cwd,
      env: { ...process.env, PYTHONUNBUFFERED: "1", PYTHONIOENCODING: "utf-8" },
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

    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf-8"); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf-8"); });

    child.on("close", (code) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);

      const parts: string[] = [];
      if (stdout.trim()) parts.push(stdout.trim());
      if (stderr.trim()) parts.push(`STDERR:\n${stderr.trim()}`);
      if (killed) parts.push("Process killed (timeout or cancelled).");
      if (code !== null && code !== 0) parts.push(`Exit code: ${code}`);

      resolve({
        content: [{ type: "text", text: truncateOutput(parts.length > 0 ? parts.join("\n\n") : "(no output)") }],
        details: { exitCode: code, killed, timeoutMs },
      });
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolve({
        content: [{ type: "text", text: `Failed to spawn python: ${err.message}` }],
        details: { exitCode: null, killed: false, timeoutMs },
      });
    });
  });
}

export function createPythonExtension(): ExtensionFactory {
  return (pi) => {
    const pythonTool: ToolDefinition<typeof PythonParams> = {
      name: "python",
      label: "Python",
      description:
        "Execute Python code. Use for data processing, calculations, file format conversion, " +
        "and tasks where Python libraries are more suitable than bash. " +
        "Code is passed via -c flag; for multi-line scripts, use triple-quoted strings or semicolons.",
      parameters: PythonParams,
      execute: async (_toolCallId, params: Static<typeof PythonParams>, signal?: AbortSignal) => {
        const timeoutMs = clampTimeout(params);
        const cwd = params.cwd?.trim() || process.cwd();
        return runPython(params.code, cwd, timeoutMs, signal);
      },
    };

    pi.registerTool(pythonTool);
  };
}
