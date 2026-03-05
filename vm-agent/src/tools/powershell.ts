import { spawn, execFileSync } from "node:child_process";
import { Type } from "@sinclair/typebox";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";

const MAX_OUTPUT_BYTES = 50 * 1024; // 50 KB
const DEFAULT_TIMEOUT_MS = 120_000; // 120s — generous for installs

// ─── Parameter Schema ───────────────────────────────

const PowershellParams = Type.Object({
  command: Type.String({ description: "The PowerShell command to execute" }),
  timeout: Type.Optional(
    Type.Number({ description: "Timeout in milliseconds (default 120000)" }),
  ),
});

// ─── Helpers ────────────────────────────────────────

function truncateOutput(text: string): string {
  if (Buffer.byteLength(text, "utf-8") <= MAX_OUTPUT_BYTES) return text;
  let truncated = text;
  while (Buffer.byteLength(truncated, "utf-8") > MAX_OUTPUT_BYTES) {
    truncated = truncated.slice(0, truncated.length - 1024);
  }
  return truncated + "\n...(output truncated to 50KB)";
}

function findPowershellExe(): string | null {
  if (process.platform !== "win32") return null;
  for (const exe of ["powershell.exe", "pwsh.exe"]) {
    try {
      execFileSync("where", [exe], { stdio: "pipe", timeout: 5_000 });
      return exe;
    } catch {
      // not found, try next
    }
  }
  return null;
}

/** Force-kill a process tree on Windows using taskkill. */
function killProcessTree(pid: number) {
  try {
    spawn("taskkill", ["/F", "/T", "/PID", String(pid)], {
      stdio: "ignore",
      windowsHide: true,
    });
  } catch {
    // best-effort
  }
}

let cachedExe: string | null | undefined;

export function isPowershellAvailable(): boolean {
  if (cachedExe === undefined) {
    cachedExe = findPowershellExe();
  }
  return cachedExe !== null;
}

// ─── Tool Factory ───────────────────────────────────

export function createPowershellTool(): ToolDefinition<typeof PowershellParams> {
  return {
    name: "powershell",
    label: "PowerShell",
    description:
      "Execute PowerShell commands on Windows. Use as fallback when bash is unavailable, or for Windows-specific operations like installing software via winget.",
    parameters: PowershellParams,
    async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
      if (process.platform !== "win32") {
        return {
          content: [{ type: "text" as const, text: "Error: PowerShell tool is only available on Windows." }],
          details: {},
        };
      }

      if (signal?.aborted) {
        return {
          content: [{ type: "text" as const, text: "Cancelled." }],
          details: {},
        };
      }

      const exe = findPowershellExe();
      if (!exe) {
        return {
          content: [{ type: "text" as const, text: "Error: PowerShell executable not found (tried powershell.exe and pwsh.exe)." }],
          details: {},
        };
      }

      const timeout = params.timeout ?? DEFAULT_TIMEOUT_MS;

      return new Promise((resolve) => {
        const utf8Preamble = "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; $OutputEncoding = [System.Text.Encoding]::UTF8; ";
        const args = ["-NoProfile", "-NonInteractive", "-Command", utf8Preamble + params.command];
        const child = spawn(exe, args, {
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
        });

        let stdout = "";
        let stderr = "";
        let killed = false;

        // Timeout: force-kill process tree
        const timer = setTimeout(() => {
          killed = true;
          if (child.pid) killProcessTree(child.pid);
        }, timeout);

        // Abort signal: forward cancellation
        const onAbort = () => {
          killed = true;
          clearTimeout(timer);
          if (child.pid) killProcessTree(child.pid);
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

          const parts: string[] = [];
          if (stdout.trim()) parts.push(stdout.trim());
          if (stderr.trim()) parts.push(`STDERR:\n${stderr.trim()}`);
          if (killed) parts.push(`\n⚠️ Process killed (timeout or cancelled).`);
          if (code !== 0 && code !== null) parts.push(`\nExit code: ${code}`);

          const output = truncateOutput(
            parts.length > 0 ? parts.join("\n") : "(no output)",
          );

          resolve({
            content: [{ type: "text" as const, text: output }],
            details: { exitCode: code, killed },
          });
        });

        child.on("error", (err) => {
          clearTimeout(timer);
          signal?.removeEventListener("abort", onAbort);
          resolve({
            content: [{ type: "text" as const, text: `Error: Failed to spawn ${exe}: ${err.message}` }],
            details: {},
          });
        });
      });
    },
  };
}
