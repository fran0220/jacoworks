/**
 * Environment PATH enrichment for GUI-launched apps
 * 
 * Problem: GUI apps don't source ~/.bashrc/~/.zshrc, so user-installed tools
 * (nvm, pyenv, conda, virtualenv) are not in PATH.
 * 
 * Solution: Auto-detect common tool paths and inject them before command execution.
 */

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";

interface EnvEnrichmentResult {
  PATH: string;
  /** Additional env vars (e.g., VIRTUAL_ENV, NVM_DIR) */
  extraEnv: Record<string, string>;
}

/**
 * Detect and enrich PATH with common tool directories.
 * Runs once per session and caches the result.
 */
export function enrichEnvironment(cwd: string): EnvEnrichmentResult {
  const paths: string[] = [];
  const extraEnv: Record<string, string> = {};
  const home = homedir();

  // 1. System PATH (from current process)
  if (process.env.PATH) {
    paths.push(process.env.PATH);
  }

  // 2. Try to load PATH from shell config (macOS/Linux only)
  if (process.platform !== "win32") {
    try {
      // Use login shell to source config files
      const shellPath = execSync("bash -l -c 'echo $PATH'", {
        encoding: "utf-8",
        timeout: 3000,
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
      if (shellPath && shellPath !== process.env.PATH) {
        paths.push(shellPath);
      }
    } catch {
      // Ignore errors (shell config may not exist)
    }
  }

  // 3. Common tool paths (check existence before adding)
  const commonPaths = [
    // Homebrew (macOS)
    "/opt/homebrew/bin",
    "/usr/local/bin",
    // nvm
    join(home, ".nvm/versions/node"),
    // pyenv
    join(home, ".pyenv/shims"),
    // conda
    join(home, "miniconda3/bin"),
    join(home, "anaconda3/bin"),
    // Rust
    join(home, ".cargo/bin"),
    // Go
    join(home, "go/bin"),
    // Project-specific: node_modules/.bin (relative to cwd)
    join(cwd, "node_modules/.bin"),
  ];

  for (const p of commonPaths) {
    if (existsSync(p) && !paths.some((existing) => existing.includes(p))) {
      paths.push(p);
    }
  }

  // 4. Detect Python virtualenv in cwd
  const venvPaths = [
    join(cwd, "venv/bin"),
    join(cwd, ".venv/bin"),
    join(cwd, "env/bin"),
  ];
  for (const venvBin of venvPaths) {
    if (existsSync(venvBin)) {
      paths.unshift(venvBin); // Prepend to prioritize virtualenv
      extraEnv.VIRTUAL_ENV = join(venvBin, "..");
      break;
    }
  }

  // 5. Detect nvm current version
  const nvmDir = process.env.NVM_DIR || join(home, ".nvm");
  if (existsSync(nvmDir)) {
    extraEnv.NVM_DIR = nvmDir;
    try {
      const nvmCurrent = join(nvmDir, "current/bin");
      if (existsSync(nvmCurrent)) {
        paths.unshift(nvmCurrent);
      }
    } catch {
      // Ignore
    }
  }

  return {
    PATH: paths.join(process.platform === "win32" ? ";" : ":"),
    extraEnv,
  };
}

/**
 * Cache enriched environment per workspace to avoid repeated detection.
 */
const envCache = new Map<string, EnvEnrichmentResult>();

export function getEnrichedEnv(cwd: string): EnvEnrichmentResult {
  if (!envCache.has(cwd)) {
    envCache.set(cwd, enrichEnvironment(cwd));
  }
  return envCache.get(cwd)!;
}
