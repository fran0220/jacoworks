import { getToken } from "../../lib/auth";
import { GATEWAY_URL } from "../../lib/config";
import { httpFetch } from "../../lib/transport";

export interface ContainerStatus {
  provisioned: boolean;
  ready?: boolean;
  status?: string;
  container_name?: string;
  container_ip?: string;
  host_port?: number;
}

export interface ProvisionResult {
  status: "ready" | "provisioning";
  container_name: string;
  ip?: string;
}

async function authedFetch(path: string, options: { method?: "GET" | "POST" } = {}) {
  const token = getToken();
  if (!token) {
    throw new Error("未登录，请重新登录");
  }

  const response = await httpFetch(`${GATEWAY_URL}${path}`, {
    method: options.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  return response;
}

function parseError(body: string, fallback: string) {
  try {
    const parsed = JSON.parse(body) as { error?: string; message?: string };
    return parsed.error || parsed.message || fallback;
  } catch {
    return fallback;
  }
}

export async function checkContainerStatus(): Promise<ContainerStatus> {
  const response = await authedFetch("/api/cowork/container-status", { method: "GET" });
  if (response.status !== 200) {
    throw new Error(parseError(response.body, `容器状态检查失败 (${response.status})`));
  }

  return JSON.parse(response.body) as ContainerStatus;
}

export async function provisionContainer(): Promise<ProvisionResult> {
  const response = await authedFetch("/api/cowork/provision", { method: "POST" });
  if (response.status < 200 || response.status > 202) {
    throw new Error(parseError(response.body, `容器分配失败 (${response.status})`));
  }

  return JSON.parse(response.body) as ProvisionResult;
}
