function shortName(filepath: string): string {
  const parts = filepath.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : filepath;
}

export function toolArgsSummary(name: string, args?: string): string {
  if (!args) return "";
  try {
    const parsed = JSON.parse(args);
    if (name === "read" || name === "edit" || name === "write") return shortName(parsed.path || "");
    if (name === "bash") return parsed.command ? `$ ${parsed.command}`.slice(0, 80) : "";
    if (name === "web_search" || name === "memory_search") return parsed.query || "";
    if (name === "web_fetch") {
      try { return new URL(parsed.url).hostname; } catch { return parsed.url || ""; }
    }
    if (name === "grep") return parsed.pattern || "";
    if (name === "find") return shortName(parsed.glob || parsed.pattern || "");
    if (name === "ls") return shortName(parsed.path || "");
    return "";
  } catch { return ""; }
}
