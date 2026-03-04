/**
 * Gateway API E2E smoke tests
 *
 * 这个文件保证 test:gateway-e2e / check-all 入口可用，
 * 后续可继续扩展为完整的 endpoint 矩阵测试。
 */

import { beforeAll, describe, expect, test } from "bun:test";
import { setupTestEnv, type TestEnv } from "./helpers/gateway-config.js";

const TIMEOUT_MS = 10_000;

let env: TestEnv | null = null;

function skipNoGateway(): boolean {
  if (!env) {
    console.log("  → skipped (no gateway)");
    return true;
  }
  return false;
}

beforeAll(async () => {
  env = await setupTestEnv();
  if (!env) {
    console.log("[gateway-e2e] ⚠️  No gateway reachable — smoke tests will be skipped");
  }
});

describe("Gateway API Smoke", () => {
  test("GET /health returns ok", async () => {
    if (skipNoGateway()) return;

    const response = await fetch(`${env!.gatewayUrl}/health`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    expect(response.status).toBe(200);
    const body = (await response.text()).trim().toLowerCase();
    expect(body).toContain("ok");
  });

  test("GET /api/users/me works with admin token", async () => {
    if (skipNoGateway()) return;

    const response = await fetch(`${env!.gatewayUrl}/api/users/me`, {
      headers: { Authorization: `Bearer ${env!.admin.token}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    expect(response.status).toBe(200);
    const me = (await response.json()) as { id: string; role: string };
    expect(me.id).toBe(env!.admin.id);
    expect(me.role).toBe("admin");
  });
});
