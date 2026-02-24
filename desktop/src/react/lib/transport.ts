import { invoke, isTauri } from "@tauri-apps/api/core";

export async function httpFetch(
  url: string,
  options: { method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<{ status: number; headers: Record<string, string>; body: string }> {
  if (!isTauri()) {
    const response = await fetch(url, {
      method: options.method ?? "GET",
      headers: options.headers,
      body: options.body,
    });
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });
    return { status: response.status, headers, body: await response.text() };
  }

  return invoke("http_fetch", {
    url,
    method: options.method ?? "GET",
    headers: options.headers ?? {},
    body: options.body,
  });
}
