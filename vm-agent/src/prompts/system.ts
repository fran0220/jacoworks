/**
 * JAcoworks System Prompt
 *
 * 3-layer architecture:
 *   Layer 1 (code): Immutable operating contract — interaction rules, safety, runtime info
 *   Layer 2 (files): User-editable preferences from agentHomeDir — SOUL.md (style), AGENTS.md (workflow), USER.md (preferences), TOOLS.md (notes)
 *   Layer 3 (optional): Project-level overlay from workspace SOUL.md
 *
 * No identity/persona declarations — the product context is implicit from the app.
 */

import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ─── Constants ──────────────────────────────────────

// AGENTS.md is loaded natively by Pi SDK (loadProjectContextFiles) — do NOT duplicate here.
// JAco only loads its own unique files: SOUL.md (persona), USER.md (prefs), TOOLS.md (notes).
const BOOTSTRAP_FILES = ["SOUL.md", "USER.md", "TOOLS.md"] as const;

const SEEDS_DIR = join(dirname(fileURLToPath(import.meta.url)), "seeds");

// ─── Layer 1: Runtime Context (code-only) ───────────

function buildRuntimePrompt(opts: SystemPromptOptions): string {
  const mode = opts.mode === "server"
    ? "You run inside a Docker container on a remote server. The workspace is a persistent volume. The container comes with Python3, Node.js, Bun, git, pandoc, and other development tools pre-installed."
    : "You run inside a cloud-managed container. The workspace is a persistent volume.";

  const now = new Date();
  const dateStr = now.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const timeStr = now.toLocaleTimeString("en-US", { hour12: false });

  const parts: string[] = [];

  parts.push(`<runtime>
<product>JAcoworks</product>
<environment>${mode}</environment>
<agent_home>${opts.agentHomeDir}</agent_home>
<workspace>${opts.workspaceDir}</workspace>
<datetime>${dateStr} ${timeStr}</datetime>
</runtime>`);

  // Safety invariants — always present regardless of bootstrap files
  parts.push(`
<safety_invariants>
- Never expose API keys, tokens, passwords, secrets, server IPs, proxy URLs, or internal infrastructure details in responses.
- Always read files before modifying them. Make minimal, targeted edits.
- Never execute destructive operations (rm -rf, DROP DATABASE, force push) without explicit user confirmation.
- Do not add unnecessary error handling, comments, or abstractions beyond what the task requires.
</safety_invariants>`);

  // Windows environment note (sidecar bundles bash + coreutils)
  if (opts.mode === "sidecar" && process.platform === "win32") {
    parts.push(`
<windows_environment>
This app bundles bash and GNU coreutils (grep, sed, find, cat, etc.) on Windows. Use bash normally — it works the same as on macOS/Linux.
CRITICAL ENCODING RULE: When creating scripts (.mjs, .js) that contain non-ASCII text (Chinese, Japanese, etc.), you MUST use the \`write\` tool to create the file. NEVER use bash heredoc, echo, or cat redirect to create script files with non-ASCII content — the shell may corrupt the encoding on Windows, causing garbled output in generated documents (Excel, Word, CSV, etc.).
</windows_environment>`);
  }

  // Active services
  const activeFeatures: string[] = [];
  if (opts.memoryEnabled) {
    activeFeatures.push(
      "- Memory system is ACTIVE. Context from MEMORY.md and daily logs is automatically injected into each conversation.",
    );
  }
  if (opts.cronEnabled) {
    activeFeatures.push(
      "- Cron scheduler is ACTIVE. You can create, list, and delete scheduled tasks that run automatically.",
    );
  }
  if (opts.heartbeatEnabled) {
    activeFeatures.push(
      "- Heartbeat service is ACTIVE. Periodic health check prompts will run in the background.",
    );
  }
  if (opts.userSkillsDir) {
    activeFeatures.push(
      `- User skills directory: ${opts.userSkillsDir} — this is where user-created and GitHub-installed skills should be saved.`,
    );
  }

  if (activeFeatures.length > 0) {
    parts.push(`\n<active_services>\n${activeFeatures.join("\n")}\n</active_services>`);
  }

  if (opts.memoryEnabled) {
    parts.push(`
<context_management>
Tool output (bash/file/document text) is temporary: older tool results are truncated and old history is compacted. Large read_document content is indexed to memory.
Use memory_save after major steps to preserve key decisions, findings, file paths, and progress.
Use memory_search to recall saved or indexed information instead of re-reading files.
Do not rely on old tool outputs remaining visible.
Treat tool output as working memory; memory_save is your persistent notebook.
</context_management>`);
  }

  return parts.join("\n");
}

// ─── Layer 2: Bootstrap Files from agentHomeDir ─────

async function loadBootstrapFile(filePath: string, maxChars: number): Promise<string> {
  try {
    const content = await readFile(filePath, "utf-8");
    const trimmed = content.trim();
    if (!trimmed) return "";
    return trimmed.length > maxChars
      ? trimmed.slice(0, maxChars) + "\n\n[... truncated ...]"
      : trimmed;
  } catch {
    return "";
  }
}

async function loadBootstrapFiles(agentHomeDir: string, maxFileChars: number, maxTotalChars: number): Promise<string> {
  const sections: string[] = [];
  let totalChars = 0;

  for (const filename of BOOTSTRAP_FILES) {
    const content = await loadBootstrapFile(join(agentHomeDir, filename), maxFileChars);
    if (!content) continue;

    if (totalChars + content.length > maxTotalChars) break;

    const tag = filename.replace(".md", "").toLowerCase();
    sections.push(`<bootstrap_${tag}>\n${content}\n</bootstrap_${tag}>`);
    totalChars += content.length;
  }

  return sections.length > 0
    ? `\n\n<agent_bootstrap>\n${sections.join("\n\n")}\n</agent_bootstrap>`
    : "";
}

// ─── Layer 3: Project-level SOUL.md overlay ─────────

async function loadProjectSoulMd(workspaceDir: string, maxChars: number): Promise<string> {
  try {
    const content = await readFile(join(workspaceDir, "SOUL.md"), "utf-8");
    const trimmed = content.trim();
    if (!trimmed) return "";
    const truncated = trimmed.length > maxChars
      ? trimmed.slice(0, maxChars) + "\n\n[... truncated ...]"
      : trimmed;
    return `\n\n<project_overlay>\nProject-specific conventions for this workspace:\n\n${truncated}\n</project_overlay>`;
  } catch {
    return "";
  }
}

// ─── First-Run Seeding ──────────────────────────────

async function seedFile(agentHomeDir: string, filename: string): Promise<void> {
  const target = join(agentHomeDir, filename);
  if (existsSync(target)) return;

  const seedSource = join(SEEDS_DIR, filename);
  await mkdir(dirname(target), { recursive: true });

  if (existsSync(seedSource)) {
    await copyFile(seedSource, target);
  } else {
    // Minimal fallback if seed file is missing from bundle
    await writeFile(target, `# ${filename.replace(".md", "")}\n\n<!-- Optional: customize here -->\n`, "utf-8");
  }
}

export async function seedAgentHome(agentHomeDir: string): Promise<void> {
  await mkdir(agentHomeDir, { recursive: true });
  for (const filename of BOOTSTRAP_FILES) {
    await seedFile(agentHomeDir, filename);
  }
}

// ─── Build final system prompt ──────────────────────

export interface SystemPromptOptions {
  mode: "sidecar" | "server";
  agentHomeDir: string;
  workspaceDir: string;
  memoryEnabled: boolean;
  cronEnabled: boolean;
  heartbeatEnabled: boolean;
  /** User-created skills directory (editable) */
  userSkillsDir?: string;
  /** Max chars per bootstrap file (default 8000) */
  maxFileChars?: number;
  /** Max total chars across all bootstrap files (default 30000) */
  maxTotalChars?: number;
  /** Extra prompt sections to append (e.g. from extensions) */
  extraSections?: string[];
}

/**
 * Build the complete system prompt in 3 layers:
 * 1. Runtime context (code-only: mode, workspace, datetime, active services)
 * 2. Bootstrap files from agentHomeDir (SOUL.md, AGENTS.md, USER.md, TOOLS.md)
 * 3. Project-level SOUL.md overlay from cwd (optional)
 * 4. Extra sections from extensions
 */
export async function buildSystemPrompt(opts: SystemPromptOptions): Promise<string> {
  const maxFileChars = opts.maxFileChars ?? 8_000;
  const maxTotalChars = opts.maxTotalChars ?? 30_000;
  const parts: string[] = [];

  // Layer 1: Runtime context
  parts.push(buildRuntimePrompt(opts));

  // Layer 2: Bootstrap files from agentHomeDir
  const bootstrap = await loadBootstrapFiles(opts.agentHomeDir, maxFileChars, maxTotalChars);
  if (bootstrap) parts.push(bootstrap);

  // Layer 3: Project-level SOUL.md overlay (only if cwd differs from agentHomeDir)
  if (opts.workspaceDir !== opts.agentHomeDir) {
    const projectSoul = await loadProjectSoulMd(opts.workspaceDir, maxFileChars);
    if (projectSoul) parts.push(projectSoul);
  }

  // Extra sections from extensions
  if (opts.extraSections?.length) {
    for (const section of opts.extraSections) {
      parts.push(`\n\n${section}`);
    }
  }

  return parts.join("\n\n");
}
