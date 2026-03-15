import type { AssistantPart } from "../types";

/** Extract flat markdown text from parts (for content field backward compat). */
export function assistantPartsToText(parts: AssistantPart[]): string {
  return parts
    .filter((p): p is Extract<AssistantPart, { kind: "markdown" }> => p.kind === "markdown")
    .map((p) => p.text)
    .join("\n\n");
}

/** Sanitize parts for persistence: no "running" tools should be saved. */
export function sanitizePartsForPersistence(
  parts: AssistantPart[],
  options?: { interrupted?: boolean },
): AssistantPart[] {
  return parts
    .filter((p) => {
      // Remove empty text/thinking parts
      if (p.kind === "markdown" && !p.text.trim()) return false;
      if (p.kind === "thinking" && !p.text.trim()) return false;
      return true;
    })
    .map((p) => {
      if (p.kind !== "tool") return p;
      if (p.status === "running") {
        // Interrupted: mark as error; normal end: should not happen
        return {
          ...p,
          status: "error" as const,
          result: p.result || (options?.interrupted ? "用户中止" : undefined),
        };
      }
      return p;
    });
}
