import { StringEnum } from "@mariozechner/pi-ai";
import { defineTool, type ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  details: Record<string, unknown>;
  isError?: boolean;
};

interface GatewayJobResponse {
  id: string;
  name?: string | null;
  schedule_kind: string;
  schedule_expr: string;
  prompt: string;
  session_target: string;
  enabled: boolean;
  delete_after_run: boolean;
  delivery_mode?: string | null;
  last_run?: string | null;
  run_count: number;
  consecutive_errors: number;
  created_at: string;
  updated_at: string;
}

const CronManageParams = Type.Object({
  action: StringEnum(["create", "list", "delete", "run", "history"] as const, {
    description: 'Action: "create" | "list" | "delete" | "run" | "history"',
  }),
  name: Type.Optional(Type.String({ description: "Human-readable job name" })),
  scheduleKind: Type.Optional(StringEnum(["cron", "at", "every"] as const, {
    description: "Schedule type",
  })),
  schedule: Type.Optional(Type.String({
    description: 'Cron expr (e.g. "0 9 * * 1-5"), ISO timestamp, relative ("+20m"), or interval ("5m", "1h")',
  })),
  prompt: Type.Optional(Type.String({
    description: "Prompt to send to the agent when triggered",
  })),
  sessionTarget: Type.Optional(StringEnum(["main", "isolated"] as const, {
    description: "Session mode",
  })),
  deleteAfterRun: Type.Optional(Type.Boolean({
    description: "Auto-delete after execution (default true for at, false for others)",
  })),
  deliveryMode: Type.Optional(StringEnum(["announce", "none"] as const, {
    description: "Delivery mode: announce (push to feishu) or none (silent)",
  })),
  jobId: Type.Optional(Type.String({ description: "Job ID" })),
  limit: Type.Optional(Type.Number({ description: "Number of history entries (default 10)" })),
});

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

function requireGatewayConfig(): { gatewayUrl: string; gatewayToken: string } | ToolResult {
  const gatewayUrl = process.env.GATEWAY_URL?.trim();
  const gatewayToken = process.env.GATEWAY_TOKEN?.trim();

  if (!gatewayUrl || !gatewayToken) {
    return {
      content: [{
        type: "text",
        text: "Error: GATEWAY_URL or GATEWAY_TOKEN is not configured for cron proxy",
      }],
      details: {},
      isError: true,
    };
  }

  return {
    gatewayUrl: normalizeBaseUrl(gatewayUrl),
    gatewayToken,
  };
}

async function proxyToGateway(
  params: {
    action: string;
    name?: string;
    scheduleKind?: string;
    schedule?: string;
    prompt?: string;
    sessionTarget?: string;
    deleteAfterRun?: boolean;
    deliveryMode?: string;
    jobId?: string;
    limit?: number;
  },
  signal?: AbortSignal,
): Promise<ToolResult> {
  const config = requireGatewayConfig();
  if ("content" in config) return config;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${config.gatewayToken}`,
  };

  try {
    switch (params.action) {
      case "create": {
        if (!params.scheduleKind || !params.schedule || !params.prompt) {
          return {
            content: [{
              type: "text",
              text: 'Error: "scheduleKind", "schedule", and "prompt" are required for create',
            }],
            details: {},
            isError: true,
          };
        }

        const body = {
          schedule_kind: params.scheduleKind,
          schedule_expr: params.schedule,
          prompt: params.prompt,
          name: params.name,
          session_target: params.sessionTarget ?? "isolated",
          delete_after_run: params.deleteAfterRun ?? (params.scheduleKind === "at"),
          delivery_mode: params.deliveryMode ?? "none",
        };
        const res = await fetch(`${config.gatewayUrl}/api/cron/jobs`, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          signal,
        });
        if (!res.ok) {
          const errText = await res.text();
          return {
            content: [{
              type: "text",
              text: `Error: gateway returned ${res.status}: ${errText}`,
            }],
            details: {},
            isError: true,
          };
        }
        const job = (await res.json()) as GatewayJobResponse;
        return {
          content: [{
            type: "text",
            text:
              `Created job ${job.id}${job.name ? ` (${job.name})` : ""}` +
              `\nSchedule: ${job.schedule_kind} \`${job.schedule_expr}\`` +
              `\nTarget: ${job.session_target}` +
              `\nDelete after run: ${job.delete_after_run}` +
              `\nPrompt: ${job.prompt}`,
          }],
          details: { job },
        };
      }

      case "list": {
        const res = await fetch(`${config.gatewayUrl}/api/cron/jobs`, {
          method: "GET",
          headers,
          signal,
        });
        if (!res.ok) {
          const errText = await res.text();
          return {
            content: [{
              type: "text",
              text: `Error: gateway returned ${res.status}: ${errText}`,
            }],
            details: {},
            isError: true,
          };
        }
        const jobs = (await res.json()) as GatewayJobResponse[];
        if (!jobs.length) {
          return {
            content: [{ type: "text", text: "No cron jobs configured." }],
            details: { jobs: [] },
          };
        }
        const text = jobs.map((job) => {
          const last = job.last_run ? ` (last: ${job.last_run})` : "";
          const errs = job.consecutive_errors > 0 ? ` ⚠️${job.consecutive_errors}err` : "";
          const mode = job.session_target === "isolated" ? " 🔒isolated" : "";
          return `- [${job.id}]${job.name ? ` ${job.name}` : ""} ${job.enabled ? "✅" : "⏸️"} ${job.schedule_kind} \`${job.schedule_expr}\`${mode}${errs} → ${job.prompt.slice(0, 60)}${last}`;
        }).join("\n");
        return {
          content: [{ type: "text", text }],
          details: { jobs },
        };
      }

      case "delete": {
        if (!params.jobId) {
          return {
            content: [{ type: "text", text: 'Error: "jobId" is required for delete' }],
            details: {},
            isError: true,
          };
        }
        const res = await fetch(`${config.gatewayUrl}/api/cron/jobs/${params.jobId}`, {
          method: "DELETE",
          headers,
          signal,
        });
        if (!res.ok) {
          const errText = await res.text();
          return {
            content: [{
              type: "text",
              text: `Error: gateway returned ${res.status}: ${errText}`,
            }],
            details: {},
            isError: true,
          };
        }
        return {
          content: [{ type: "text", text: `Deleted job ${params.jobId}` }],
          details: { removed: true },
        };
      }

      case "run": {
        if (!params.jobId) {
          return {
            content: [{ type: "text", text: 'Error: "jobId" is required for run' }],
            details: {},
            isError: true,
          };
        }
        const res = await fetch(`${config.gatewayUrl}/api/cron/jobs/${params.jobId}/run`, {
          method: "POST",
          headers,
          signal,
        });
        if (!res.ok) {
          const errText = await res.text();
          return {
            content: [{
              type: "text",
              text: `Error: gateway returned ${res.status}: ${errText}`,
            }],
            details: {},
            isError: true,
          };
        }
        const result = (await res.json()) as { status: string; message: string };
        return {
          content: [{ type: "text", text: `Job ${params.jobId}: ${result.message}` }],
          details: { result },
        };
      }

      case "history": {
        if (!params.jobId) {
          return {
            content: [{ type: "text", text: 'Error: "jobId" is required for history' }],
            details: {},
            isError: true,
          };
        }
        const limit = params.limit ?? 10;
        const res = await fetch(`${config.gatewayUrl}/api/cron/jobs/${params.jobId}/history?limit=${limit}`, {
          method: "GET",
          headers,
          signal,
        });
        if (!res.ok) {
          const errText = await res.text();
          return {
            content: [{
              type: "text",
              text: `Error: gateway returned ${res.status}: ${errText}`,
            }],
            details: {},
            isError: true,
          };
        }
        const result = (await res.json()) as { status: string; message: string };
        return {
          content: [{ type: "text", text: result.message }],
          details: { result },
        };
      }

      default:
        return {
          content: [{ type: "text", text: `Unknown action: ${params.action}` }],
          details: {},
          isError: true,
        };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: "text", text: `Error: gateway proxy failed: ${message}` }],
      details: {},
      isError: true,
    };
  }
}

export default function registerCronProxyExtension(pi: ExtensionAPI) {
  const tool = defineTool<typeof CronManageParams, Record<string, unknown>>({
    name: "cron_manage",
    label: "Cron Manager",
    description:
      "Create, list, delete, manually run, or view history of scheduled jobs via the Gateway cron API.",
    promptSnippet:
      "Use to create, inspect, run, or delete scheduled jobs and to view their execution history.",
    parameters: CronManageParams,
    execute: async (_toolCallId, params, signal) => proxyToGateway(params, signal),
  });

  pi.registerTool(tool);
}
