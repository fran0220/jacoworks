export const GATEWAY_URL = (window.__GATEWAY_URL__ || "").replace(/\/$/, "");
export const AUTH_TOKEN = window.__AUTH_TOKEN__ || "";
export const USER_NAME = window.__USER_NAME__ || "";
export function getOpenClawToken(): string {
  return window.__OPENCLAW_TOKEN__ || window.__OPENCLAW_GATEWAY_TOKEN__ || "";
}

export const OPENCLAW_TOKEN = getOpenClawToken();

export const DEFAULT_OPENCLAW_SESSION_KEY = window.__OPENCLAW_SESSION_KEY__ || "agent:default:main";
