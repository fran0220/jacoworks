type LogLevel = "debug" | "info" | "warn" | "error";

interface LogContext {
  trace_id?: string;
  session_id?: string;
  user_id?: string;
  [key: string]: unknown;
}

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const minLevel = (process.env.LOG_LEVEL || "info") as LogLevel;

function shouldLog(level: LogLevel): boolean {
  return (LEVELS[level] ?? 20) >= (LEVELS[minLevel] ?? 20);
}

function emit(level: LogLevel, msg: string, ctx?: LogContext) {
  if (!shouldLog(level)) return;
  const entry: Record<string, unknown> = {
    level,
    msg,
    ts: new Date().toISOString(),
    ...ctx,
  };
  for (const k of Object.keys(entry)) {
    if (entry[k] === undefined) delete entry[k];
  }
  process.stderr.write(JSON.stringify(entry) + "\n");
}

export function createLogger(defaults?: LogContext) {
  const base = defaults || {};
  return {
    debug: (msg: string, ctx?: LogContext) => emit("debug", msg, { ...base, ...ctx }),
    info: (msg: string, ctx?: LogContext) => emit("info", msg, { ...base, ...ctx }),
    warn: (msg: string, ctx?: LogContext) => emit("warn", msg, { ...base, ...ctx }),
    error: (msg: string, ctx?: LogContext) => emit("error", msg, { ...base, ...ctx }),
    child: (childCtx: LogContext) => createLogger({ ...base, ...childCtx }),
  };
}

export type Logger = ReturnType<typeof createLogger>;
export const log = createLogger({ service: "vm-agent" });
