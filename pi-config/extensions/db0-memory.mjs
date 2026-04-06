import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

function resolveGlobalNodeModulesRoot() {
  const prefix = process.env.npm_config_prefix?.trim();
  if (prefix) {
    const candidate = join(prefix, "lib", "node_modules");
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  const command = process.platform === "win32" ? "npm.cmd" : "npm";
  const output = execFileSync(command, ["root", "-g"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();

  if (!output) {
    throw new Error("npm root -g returned an empty path");
  }
  return output;
}

async function importGlobalPackage(packageName, entry = "dist/index.js") {
  const packageRoot = join(resolveGlobalNodeModulesRoot(), packageName, entry);
  if (!existsSync(packageRoot)) {
    throw new Error(`Cannot find ${packageName} at ${packageRoot}`);
  }
  return import(pathToFileURL(packageRoot).href);
}

export default async function registerDb0Memory(pi) {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    console.warn("[db0-memory] DATABASE_URL is not set; skipping db0 memory registration.");
    return;
  }

  try {
    const [{ createDb0PiExtension }, { createPostgresBackend }] = await Promise.all([
      importGlobalPackage("@db0-ai/pi"),
      importGlobalPackage("@db0-ai/backends-postgres"),
    ]);

    const backend = await createPostgresBackend(databaseUrl);
    const extension = await createDb0PiExtension({ backend });
    await extension.register(pi);
  } catch (error) {
    console.error("[db0-memory] Failed to register db0 memory extension:", error);
  }
}
