/**
 * JAcoworks System Prompt — 企业 AI 协同办公平台
 *
 * 3-layer architecture following OpenClaw pattern:
 *   Layer 1 (code): Compact runtime-only sections — tooling, safety, runtime info
 *   Layer 2 (files): Bootstrap files from agentHomeDir — SOUL.md, AGENTS.md, USER.md, TOOLS.md
 *   Layer 3 (optional): Project-level SOUL.md overlay from cwd
 *
 * 注入方式: DefaultResourceLoader.appendSystemPrompt
 */

import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ─── Constants ──────────────────────────────────────

const MAX_FILE_CHARS = 20_000;
const MAX_TOTAL_CHARS = 100_000;

const BOOTSTRAP_FILES = ["SOUL.md", "AGENTS.md", "USER.md", "TOOLS.md"] as const;

const SEEDS_DIR = join(dirname(fileURLToPath(import.meta.url)), "seeds");

// ─── Layer 1: Runtime Context (code-only) ───────────

function buildRuntimePrompt(opts: SystemPromptOptions): string {
  const mode = opts.mode === "server"
    ? "You run inside a Docker container on a remote server. The workspace is a persistent volume."
    : "You run as a local agent sidecar on the user's desktop computer. You have direct access to the user's local file system through a workspace directory — there is no cloud container or remote VM involved.";

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
<application>JAcoworks — Enterprise AI Collaboration Platform</application>
<environment>${mode}</environment>
<agent_home>${opts.agentHomeDir}</agent_home>
<workspace>${opts.workspaceDir}</workspace>
<datetime>${dateStr} ${timeStr}</datetime>
<identity_note>You are the JAcoworks AI Assistant ("JAco"). Do NOT refer to yourself as "Pi" or mention the Pi SDK unless asked about technical implementation details.</identity_note>
<multi_model>You support multiple LLM providers (Claude, GPT, Gemini, Grok). Adapt naturally to model changes without disrupting the conversation.</multi_model>
</runtime>`);

  // Safety invariants — always present regardless of bootstrap files
  parts.push(`
<safety_invariants>
- Never expose API keys, tokens, passwords, secrets, server IPs, proxy URLs, or internal infrastructure details in responses.
- Always read files before modifying them. Make minimal, targeted edits.
- Never execute destructive operations (rm -rf, DROP DATABASE, force push) without explicit user confirmation.
- Never auto-open files with open/xdg-open/start — present file paths in backticks for desktop file cards.
- Do not add unnecessary error handling, comments, or abstractions beyond what the task requires.
</safety_invariants>`);

  // Windows environment self-repair instructions (sidecar only)
  if (opts.mode === "sidecar") {
    parts.push(`
<windows_environment>
On Windows, if bash fails with shell-not-found errors, use the powershell tool to install Git for Windows (which includes bash) via winget. Similarly install Node.js if needed. Do NOT ask the user to install manually.
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

  return parts.join("\n");
}

// ─── Layer 2: Bootstrap Files from agentHomeDir ─────

async function loadBootstrapFile(filePath: string): Promise<string> {
  try {
    const content = await readFile(filePath, "utf-8");
    const trimmed = content.trim();
    if (!trimmed) return "";
    return trimmed.length > MAX_FILE_CHARS
      ? trimmed.slice(0, MAX_FILE_CHARS) + "\n\n[... truncated ...]"
      : trimmed;
  } catch {
    return "";
  }
}

async function loadBootstrapFiles(agentHomeDir: string): Promise<string> {
  const sections: string[] = [];
  let totalChars = 0;

  for (const filename of BOOTSTRAP_FILES) {
    const content = await loadBootstrapFile(join(agentHomeDir, filename));
    if (!content) continue;

    if (totalChars + content.length > MAX_TOTAL_CHARS) break;

    const tag = filename.replace(".md", "").toLowerCase();
    sections.push(`<bootstrap_${tag}>\n${content}\n</bootstrap_${tag}>`);
    totalChars += content.length;
  }

  return sections.length > 0
    ? `\n\n<agent_bootstrap>\n${sections.join("\n\n")}\n</agent_bootstrap>`
    : "";
}

// ─── Layer 3: Project-level SOUL.md overlay ─────────

async function loadProjectSoulMd(workspaceDir: string): Promise<string> {
  try {
    const content = await readFile(join(workspaceDir, "SOUL.md"), "utf-8");
    const trimmed = content.trim();
    if (!trimmed) return "";
    const truncated = trimmed.length > MAX_FILE_CHARS
      ? trimmed.slice(0, MAX_FILE_CHARS) + "\n\n[... truncated ...]"
      : trimmed;
    return `\n\n<project_personality>\nThe following instructions are provided by the project workspace and take precedence for behavior in this project:\n\n${truncated}\n</project_personality>`;
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
    await writeFile(target, `# ${filename.replace(".md", "")}\n\n<!-- Edit this file to customize JAco's behavior -->\n`, "utf-8");
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
  const parts: string[] = [];

  // Layer 1: Runtime context
  parts.push(buildRuntimePrompt(opts));

  // Layer 2: Bootstrap files from agentHomeDir
  const bootstrap = await loadBootstrapFiles(opts.agentHomeDir);
  if (bootstrap) parts.push(bootstrap);

  // Layer 3: Project-level SOUL.md overlay (only if cwd differs from agentHomeDir)
  if (opts.workspaceDir !== opts.agentHomeDir) {
    const projectSoul = await loadProjectSoulMd(opts.workspaceDir);
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
