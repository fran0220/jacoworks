import { Capacitor } from "@capacitor/core";

export type RuntimePlatform = "web" | "ios" | "android";

export function isCapacitorApp(): boolean {
  return Capacitor.isNativePlatform();
}

export function getRuntimePlatform(): RuntimePlatform {
  const platform = Capacitor.getPlatform();
  if (platform === "ios" || platform === "android") return platform;
  return "web";
}

export function isCompactViewport(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(max-width: 768px)").matches;
}

export function shouldUseExternalDesktop(): boolean {
  return isCapacitorApp() || isCompactViewport();
}
