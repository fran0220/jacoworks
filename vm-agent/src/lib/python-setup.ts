/**
 * Python environment setup for mainland China users.
 * 
 * Problems:
 * - PyPI is slow/blocked in China
 * - Users don't know how to configure pip mirrors
 * 
 * Solution:
 * - Auto-detect China region and configure pip mirrors
 * - Use Tsinghua/Aliyun mirrors (fastest in China)
 */

import { existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { execSync } from "node:child_process";

const CHINA_PIP_MIRRORS = [
  "https://pypi.tuna.tsinghua.edu.cn/simple", // Tsinghua University
  "https://mirrors.aliyun.com/pypi/simple/", // Alibaba Cloud
  "https://mirrors.cloud.tencent.com/pypi/simple", // Tencent Cloud
];

/**
 * Detect if user is in mainland China (heuristic).
 */
function isInChina(): boolean {
  // Check timezone
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (tz === "Asia/Shanghai" || tz === "Asia/Chongqing") {
    return true;
  }

  // Check locale
  const locale = Intl.DateTimeFormat().resolvedOptions().locale;
  if (locale.startsWith("zh-CN")) {
    return true;
  }

  return false;
}

/**
 * Configure pip to use China mirrors.
 * Creates/updates ~/.pip/pip.conf (Linux/macOS) or %APPDATA%\pip\pip.ini (Windows).
 */
export function setupPipMirror(): void {
  if (!isInChina()) {
    return; // Skip if not in China
  }

  const pipConfigDir =
    process.platform === "win32"
      ? join(process.env.APPDATA || join(homedir(), "AppData", "Roaming"), "pip")
      : join(homedir(), ".pip");

  const pipConfigFile =
    process.platform === "win32" ? join(pipConfigDir, "pip.ini") : join(pipConfigDir, "pip.conf");

  // Skip if already configured
  if (existsSync(pipConfigFile)) {
    return;
  }

  // Create config directory
  if (!existsSync(pipConfigDir)) {
    mkdirSync(pipConfigDir, { recursive: true });
  }

  // Write pip config
  const config = `[global]
index-url = ${CHINA_PIP_MIRRORS[0]}

[install]
trusted-host = pypi.tuna.tsinghua.edu.cn
`;

  writeFileSync(pipConfigFile, config, "utf-8");
  console.log(`[pip] Configured China mirror: ${CHINA_PIP_MIRRORS[0]}`);
}

/**
 * Install Python package with China mirror fallback.
 */
export function pipInstall(packageName: string, cwd: string): void {
  const mirrors = isInChina() ? CHINA_PIP_MIRRORS : [];

  for (let i = 0; i <= mirrors.length; i++) {
    try {
      const indexUrl = i < mirrors.length ? mirrors[i] : undefined;
      const cmd = indexUrl
        ? `pip install ${packageName} -i ${indexUrl}`
        : `pip install ${packageName}`;

      execSync(cmd, {
        cwd,
        stdio: "inherit",
        timeout: 60_000,
      });

      return; // Success
    } catch (err) {
      if (i === mirrors.length) {
        throw err; // All mirrors failed
      }
      console.warn(`[pip] Mirror ${mirrors[i]} failed, trying next...`);
    }
  }
}
