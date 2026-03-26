import type { User } from "../types";
import { GATEWAY_URL } from "./config";
import { httpFetch } from "./transport";

const TOKEN_KEY = "jacoworks_token";
const USER_KEY = "jacoworks_user";

let token: string | null = null;
let user: User | null = null;

const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) {
    listener();
  }
}

function restoreSession() {
  try {
    const savedToken = localStorage.getItem(TOKEN_KEY);
    const savedUser = localStorage.getItem(USER_KEY);
    if (savedToken && savedUser) {
      token = savedToken;
      user = JSON.parse(savedUser) as User;
    }
  } catch {
    token = null;
    user = null;
  }
}

restoreSession();

export function subscribeAuth(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function saveSession(nextToken: string, nextUser: User) {
  token = nextToken;
  user = nextUser;
  try {
    localStorage.setItem(TOKEN_KEY, nextToken);
    localStorage.setItem(USER_KEY, JSON.stringify(nextUser));
  } catch {
    // Ignore storage errors.
  }
  notify();
}

function clearSession() {
  token = null;
  user = null;
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  } catch {
    // Ignore storage errors.
  }
  notify();
}

async function authFetch(
  path: string,
  options: { method?: string; headers?: Record<string, string>; body?: string } = {},
) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...options.headers,
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await httpFetch(`${GATEWAY_URL}${path}`, {
    method: options.method ?? "POST",
    headers,
    body: options.body,
  });

  if (response.status === 401 && token && path !== "/api/auth/login" && path !== "/api/auth/activate") {
    clearSession();
    // Notify listeners that session expired so UI can show a message
    if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
      window.dispatchEvent(new CustomEvent("auth-expired", { detail: { path } }));
    }
  }

  return response;
}

export async function login(username: string, secret: string) {
  const response = await authFetch("/api/auth/login", {
    body: JSON.stringify({ username, password: secret }),
  });
  if (response.status !== 200) {
    const message = parseError(response.body, "登录失败");
    throw new Error(message);
  }

  const data = JSON.parse(response.body);
  saveSession(data.token, data.user);
}

export async function activateWithCode(code: string, username: string, secret: string) {
  const response = await authFetch("/api/auth/activate", {
    body: JSON.stringify({ code, username, password: secret }),
  });
  if (response.status !== 200) {
    const message = parseError(response.body, "激活失败");
    throw new Error(message);
  }

  const data = JSON.parse(response.body);
  saveSession(data.token, data.user);
}

export async function loginWithFeishu() {
  const { isTauri } = await import("@tauri-apps/api/core");

  if (!isTauri()) {
    const frontendUrl = window.location.origin;
    window.location.href = `${GATEWAY_URL}/api/auth/feishu?redirect=${encodeURIComponent(frontendUrl)}`;
    return;
  }

  const { invoke } = await import("@tauri-apps/api/core");
  const { listen } = await import("@tauri-apps/api/event");

  const port = await invoke<number>("start_oauth_callback_server");
  const redirectUrl = `http://localhost:${port}`;
  const authUrl = `${GATEWAY_URL}/api/auth/feishu?redirect=${encodeURIComponent(redirectUrl)}`;

  const callbackPromise = new Promise<string>((resolve, reject) => {
    let cleanup: (() => void) | null = null;

    listen<{ token?: string; error?: string }>("oauth-callback", (event) => {
      cleanup?.();
      const { token: callbackToken, error } = event.payload;
      if (error) {
        reject(new Error(`飞书登录失败: ${error}`));
      } else if (callbackToken) {
        resolve(callbackToken);
      } else {
        reject(new Error("未收到登录凭证"));
      }
    }).then(unlisten => { cleanup = unlisten; });
  });

  await invoke("open_url_in_browser", { url: authUrl });

  const callbackToken = await callbackPromise;

  token = callbackToken;
  const response = await authFetch("/api/users/me", { method: "GET" });
  if (response.status !== 200) {
    clearSession();
    throw new Error("Session 验证失败");
  }

  const data = JSON.parse(response.body);
  saveSession(callbackToken, {
    id: data.id || "",
    name: data.name || "",
    email: data.email || "",
    role: data.role || "user",
  });
}

export async function handleOAuthCallback(): Promise<boolean> {
  const params = new URLSearchParams(window.location.search);
  const hash = window.location.hash.startsWith("#")
    ? window.location.hash.slice(1)
    : window.location.hash;
  const hashParams = new URLSearchParams(hash);
  const callbackToken = hashParams.get("token") || params.get("token");
  const callbackError = hashParams.get("error") || params.get("error");

  if (callbackError) {
    window.history.replaceState({}, "", window.location.pathname);
    throw new Error(`登录失败: ${callbackError}`);
  }

  if (!callbackToken) return false;

  window.history.replaceState({}, "", window.location.pathname);
  token = callbackToken;

  const response = await authFetch("/api/users/me", { method: "GET" });
  if (response.status !== 200) {
    clearSession();
    throw new Error("Session 验证失败");
  }

  const data = JSON.parse(response.body);
  saveSession(callbackToken, {
    id: data.id || "",
    name: data.name || "",
    email: data.email || "",
    role: data.role || "user",
  });
  return true;
}

export function logout() {
  if (token) {
    authFetch("/api/auth/logout", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => {});
  }
  clearSession();
}

export async function fetchAgentConfig(): Promise<{
  llm_proxy_url: string;
  llm_proxy_key: string;
  openai_api_key?: string;
  exa_api_key?: string;
  tavily_api_key?: string;
  embedding_base_url?: string;
  embedding_api_key?: string;
  fal_api_key?: string;
  mineru_token?: string;
  jimeng_api_url?: string;
  jimeng_api_key?: string;
  primary_model?: string;
  primary_provider?: string;
  models?: Array<{ id: string; provider: string; label: string }>;
}> {
  const response = await authFetch("/api/agent/config", { method: "GET" });
  if (response.status !== 200) {
    throw new Error(parseError(response.body, `获取 Agent 配置失败 (${response.status})`));
  }
  return JSON.parse(response.body);
}

export function getToken() {
  return token;
}

export function getUser() {
  return user;
}

export function isAuthenticated() {
  return token !== null;
}

function parseError(body: string, fallback: string) {
  try {
    const data = JSON.parse(body);
    return data.error || fallback;
  } catch {
    return fallback;
  }
}
