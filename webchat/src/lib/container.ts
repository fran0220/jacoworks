import { GATEWAY_URL, AUTH_TOKEN } from "./config";

export interface ContainerStatus {
  provisioned: boolean;
  ready?: boolean;
  status?: string;
  container_name?: string;
  container_ip?: string;
  container_type?: string;
  container_token?: string;
}

export interface ProvisionResult {
  status: "ready" | "provisioning";
  container_name: string;
  container_token?: string;
}

async function apiFetch(
  path: string,
  options: { method?: string; body?: string } = {},
): Promise<{ status: number; body: string }> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${AUTH_TOKEN}`,
  };
  const res = await fetch(`${GATEWAY_URL}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body,
  });
  return { status: res.status, body: await res.text() };
}

export async function getContainerStatus(): Promise<ContainerStatus> {
  const res = await apiFetch("/api/cowork/container-status?container_type=openclaw");
  if (res.status !== 200) throw new Error("容器状态检查失败");
  return JSON.parse(res.body);
}

export async function provisionContainer(): Promise<ProvisionResult> {
  const res = await apiFetch("/api/cowork/provision", {
    method: "POST",
    body: JSON.stringify({ container_type: "openclaw" }),
  });
  if (res.status < 200 || res.status > 202) throw new Error("容器分配失败");
  return JSON.parse(res.body);
}
