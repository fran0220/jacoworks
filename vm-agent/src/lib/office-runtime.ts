/**
 * Office Runtime Manager
 *
 * Manages optional LibreOffice runtime for document conversion:
 *   - DOCX → PDF conversion
 *   - XLSX formula recalculation
 *   - PPTX → PDF conversion
 *
 * Strategy:
 *   1. Check system PATH for soffice
 *   2. Check managed runtime in agentHomeDir/runtimes/libreoffice/
 *   3. If not found, report as unavailable (download prompting is handled by the tool)
 *
 * PyMuPDF (bundled) covers PDF→image, so poppler is NOT required.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// Platform-specific LibreOffice paths
const SYSTEM_SOFFICE_PATHS: Record<string, string[]> = {
  darwin: [
    "/Applications/LibreOffice.app/Contents/MacOS/soffice",
    "/usr/local/bin/soffice",
    "/opt/homebrew/bin/soffice",
  ],
  win32: [
    "C:\\Program Files\\LibreOffice\\program\\soffice.exe",
    "C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe",
  ],
  linux: [
    "/usr/bin/soffice",
    "/usr/local/bin/soffice",
    "/snap/bin/libreoffice",
  ],
};

export interface OfficeRuntimeInfo {
  available: boolean;
  sofficePath: string | null;
  version: string | null;
  source: "system" | "managed" | null;
}

let cachedInfo: OfficeRuntimeInfo | null = null;

/**
 * Find soffice binary on system PATH or known locations.
 */
function findSystemSoffice(): string | null {
  const platform = process.platform;
  const candidates = SYSTEM_SOFFICE_PATHS[platform] ?? [];

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  // Also check PATH
  const pathDirs = (process.env.PATH ?? "").split(platform === "win32" ? ";" : ":");
  const binary = platform === "win32" ? "soffice.exe" : "soffice";
  for (const dir of pathDirs) {
    const full = join(dir, binary);
    if (existsSync(full)) return full;
  }

  return null;
}

/**
 * Find managed LibreOffice runtime in agent home dir.
 */
function findManagedSoffice(agentHomeDir: string): string | null {
  const platform = process.platform;
  const runtimeDir = join(agentHomeDir, "runtimes", "libreoffice");

  if (!existsSync(runtimeDir)) return null;

  const candidates: string[] = [];
  if (platform === "darwin") {
    candidates.push(join(runtimeDir, "LibreOffice.app", "Contents", "MacOS", "soffice"));
    candidates.push(join(runtimeDir, "program", "soffice"));
  } else if (platform === "win32") {
    candidates.push(join(runtimeDir, "program", "soffice.exe"));
  } else {
    candidates.push(join(runtimeDir, "program", "soffice"));
  }

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Get soffice version string.
 */
async function getSofficeVersion(sofficePath: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(sofficePath, ["--version"], { timeout: 10_000 });
    const match = stdout.match(/LibreOffice\s+(\S+)/i);
    return match?.[1] ?? stdout.trim().slice(0, 50);
  } catch {
    return null;
  }
}

/**
 * Detect and cache LibreOffice availability.
 */
export async function detectOfficeRuntime(agentHomeDir: string): Promise<OfficeRuntimeInfo> {
  if (cachedInfo) return cachedInfo;

  // 1. Check managed runtime first (preferred — pinned version)
  const managed = findManagedSoffice(agentHomeDir);
  if (managed) {
    const version = await getSofficeVersion(managed);
    cachedInfo = { available: true, sofficePath: managed, version, source: "managed" };
    return cachedInfo;
  }

  // 2. Check system
  const system = findSystemSoffice();
  if (system) {
    const version = await getSofficeVersion(system);
    cachedInfo = { available: true, sofficePath: system, version, source: "system" };
    return cachedInfo;
  }

  cachedInfo = { available: false, sofficePath: null, version: null, source: null };
  return cachedInfo;
}

/**
 * Reset cached detection (e.g., after user installs LibreOffice).
 */
export function resetOfficeRuntimeCache(): void {
  cachedInfo = null;
}

/**
 * Run soffice for document conversion.
 * Returns the output file path on success.
 */
export async function runSofficeConvert(
  sofficePath: string,
  inputFile: string,
  outputDir: string,
  format: string,
  timeoutMs = 60_000,
): Promise<{ success: boolean; output: string; error?: string }> {
  try {
    const args = [
      "--headless",
      "--norestore",
      "--nofirststartwizard",
      "--convert-to", format,
      "--outdir", outputDir,
      inputFile,
    ];

    const { stdout, stderr } = await execFileAsync(sofficePath, args, { timeout: timeoutMs });

    // soffice outputs "convert <path> -> <path> using filter..."
    const match = stdout.match(/-> (.+?) using/);
    const outputPath = match?.[1]?.trim() ?? "";

    if (stderr && !stdout.includes("->")) {
      return { success: false, output: "", error: stderr.trim() };
    }

    return { success: true, output: outputPath || stdout.trim() };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, output: "", error: msg };
  }
}

/**
 * Run soffice for XLSX formula recalculation.
 */
export async function runSofficeRecalc(
  sofficePath: string,
  inputFile: string,
  outputFile: string,
  timeoutMs = 60_000,
): Promise<{ success: boolean; error?: string }> {
  try {
    // LibreOffice macro to recalculate and save
    const macro = `
import subprocess, sys, shutil, os
soffice = sys.argv[1]
infile = os.path.abspath(sys.argv[2])
outfile = os.path.abspath(sys.argv[3])

# Convert xlsx→xlsx forces recalculation
outdir = os.path.dirname(outfile)
result = subprocess.run(
    [soffice, "--headless", "--norestore", "--calc",
     "--convert-to", "xlsx", "--outdir", outdir, infile],
    capture_output=True, text=True, timeout=${Math.floor(timeoutMs / 1000)}
)
if result.returncode != 0:
    print(f"ERROR: {result.stderr}", file=sys.stderr)
    sys.exit(1)
# Rename to target
converted = os.path.join(outdir, os.path.splitext(os.path.basename(infile))[0] + ".xlsx")
if converted != outfile and os.path.exists(converted):
    shutil.move(converted, outfile)
print("OK")
`;

    const pythonCmd = process.platform === "win32" ? "python" : "python3";
    const { stdout, stderr } = await execFileAsync(
      pythonCmd,
      ["-c", macro, sofficePath, inputFile, outputFile],
      { timeout: timeoutMs },
    );

    if (stderr.trim()) {
      return { success: false, error: stderr.trim() };
    }

    return { success: stdout.includes("OK") };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg };
  }
}
