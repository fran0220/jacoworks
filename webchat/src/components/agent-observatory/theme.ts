import type { MutableRefObject } from "react";
import { setRoleLabels } from "../../lib/feed-translate";
import type { TemplateTheme } from "../../lib/teams";

const ROLE_OVERRIDES_GLOBAL_KEY = "__JACOWORKS_OBSERVATORY_ROLE_OVERRIDES__";
const ZONE_LABELS_GLOBAL_KEY = "__JACOWORKS_OBSERVATORY_ZONE_LABELS__";

const DEFAULT_ROLE_COLORS: Record<string, string> = {
  planner: "#3b82f6",
  executor: "#f97316",
  reviewer: "#22c55e",
  patrol: "#a855f7",
};

function hashStringToHue(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i += 1) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return ((hash % 360) + 360) % 360;
}

function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;

  if (h < 60) {
    r = c;
    g = x;
  } else if (h < 120) {
    r = x;
    g = c;
  } else if (h < 180) {
    g = c;
    b = x;
  } else if (h < 240) {
    g = x;
    b = c;
  } else if (h < 300) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }

  const toHex = (value: number) =>
    Math.round((value + m) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

export function roleColor(role: string, theme?: TemplateTheme): string {
  const themedColor = theme?.roles?.[role]?.color;
  if (themedColor) return themedColor;
  return DEFAULT_ROLE_COLORS[role] ?? hslToHex(hashStringToHue(role), 0.7, 0.55);
}

function setObservatoryRoleOverrides(
  overrides: Record<
    string,
    { color: number; emissive: number; namePrefix: string }
  > | null,
): void {
  const globalState = globalThis as Record<string, unknown>;
  globalState[ROLE_OVERRIDES_GLOBAL_KEY] = overrides;
}

function setObservatoryZoneLabels(labels: Record<string, string> | null): void {
  const globalState = globalThis as Record<string, unknown>;
  globalState[ZONE_LABELS_GLOBAL_KEY] = labels;
}

export function applyObservatoryTheme(
  theme: TemplateTheme | undefined,
  appliedThemeRef: MutableRefObject<string | null>,
) {
  const themeKey = theme?.sceneKind ?? "default";
  if (appliedThemeRef.current === themeKey) return;
  appliedThemeRef.current = themeKey;

  if (theme) {
    if (theme.roles) {
      const overrides: Record<
        string,
        { color: number; emissive: number; namePrefix: string }
      > = {};
      for (const [role, cfg] of Object.entries(theme.roles)) {
        const hex = parseInt(cfg.color.replace("#", ""), 16);
        const darkerHex = Math.floor(hex * 0.6);
        overrides[role] = {
          color: hex,
          emissive: darkerHex,
          namePrefix: cfg.displayName.slice(0, 1),
        };
      }
      setObservatoryRoleOverrides(overrides);
    }
    if (theme.zones) {
      const labels: Record<string, string> = {};
      for (const [zoneId, cfg] of Object.entries(theme.zones)) {
        labels[zoneId] = cfg.label;
      }
      setObservatoryZoneLabels(labels);
    }
    if (theme.roles) {
      const labels: Record<string, string> = {};
      for (const [role, cfg] of Object.entries(theme.roles)) {
        labels[role] = cfg.displayName;
      }
      setRoleLabels(labels);
    }
    return;
  }

  setObservatoryRoleOverrides(null);
  setObservatoryZoneLabels(null);
  setRoleLabels(null as unknown as Record<string, string>);
}
