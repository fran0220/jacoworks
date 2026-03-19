import { isCapacitorApp } from "./platform";

export async function openExternalUrl(url: string): Promise<void> {
  if (!url) return;

  if (isCapacitorApp()) {
    const { Browser } = await import("@capacitor/browser");
    await Browser.open({ url, presentationStyle: "fullscreen" });
    return;
  }

  if (typeof window !== "undefined") {
    const opened = window.open(url, "_blank", "noopener,noreferrer");
    if (opened) return;
    window.location.assign(url);
  }
}
