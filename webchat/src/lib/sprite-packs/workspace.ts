import {
  BUILTIN_AGENT_SPRITE_PACKS,
  DEFAULT_SPRITE_PACK_ID,
  SPRITE_PACKS_UPDATED_EVENT,
  WORKSPACE_SPRITE_STORAGE_KEY,
} from "./constants";
import { maybeSpritePackId } from "./registry";
import type {
  ProfileSpritePackAssignment,
  SpritePackCacheEntry,
} from "./types";

function normalizeWorkspaceKey(workspaceKey?: string | null): string {
  return typeof workspaceKey === "string" ? workspaceKey.trim() : "";
}

function readWorkspaceSpritePackMap(): Record<string, string> {
  if (typeof window === "undefined") return {};

  try {
    const raw = window.localStorage.getItem(WORKSPACE_SPRITE_STORAGE_KEY) || "{}";
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};

    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).flatMap(
        ([workspaceKey, spritePackId]) => {
          const normalizedWorkspaceKey = normalizeWorkspaceKey(workspaceKey);
          const normalizedSpritePackId = maybeSpritePackId(spritePackId);
          if (!normalizedWorkspaceKey || !normalizedSpritePackId) return [];
          return [[normalizedWorkspaceKey, normalizedSpritePackId]];
        },
      ),
    );
  } catch {
    return {};
  }
}

function persistWorkspaceSpritePackMap(nextMap: Record<string, string>): void {
  if (typeof window === "undefined") return;

  window.localStorage.setItem(WORKSPACE_SPRITE_STORAGE_KEY, JSON.stringify(nextMap));
  window.dispatchEvent(new CustomEvent(SPRITE_PACKS_UPDATED_EVENT));
}

function cacheWorkspaceSpritePackEntries(entries: SpritePackCacheEntry[]): void {
  if (typeof window === "undefined" || entries.length === 0) return;

  const current = readWorkspaceSpritePackMap();
  let changed = false;
  const next = { ...current };

  for (const entry of entries) {
    const workspaceKey = normalizeWorkspaceKey(entry.workspaceKey);
    const spritePackId = maybeSpritePackId(entry.spritePackId);
    if (!workspaceKey || !spritePackId) continue;
    if (next[workspaceKey] === spritePackId) continue;
    next[workspaceKey] = spritePackId;
    changed = true;
  }

  if (changed) {
    persistWorkspaceSpritePackMap(next);
  }
}

function parseAgentIdFromSessionKey(sessionKey: string): string | null {
  const trimmed = sessionKey.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^agent:([^:]+)(?::(?:main|t-[^:]+))?$/);
  return match ? match[1] : null;
}

function parseTeamTemplateIdFromSessionKey(sessionKey: string): string | null {
  const match = sessionKey.trim().match(/^team:([^:]+)(?::|$)/);
  return match ? match[1] : null;
}

export function buildProfileWorkspaceKey(profileName: string): string {
  return `agent:${profileName.trim()}:main`;
}

export function getWorkspaceAgentId(workspaceKey: string): string | null {
  return parseAgentIdFromSessionKey(workspaceKey);
}

export function getStoredWorkspaceSpritePackId(workspaceKey: string): string | null {
  const normalizedWorkspaceKey = normalizeWorkspaceKey(workspaceKey);
  if (!normalizedWorkspaceKey) return null;
  return readWorkspaceSpritePackMap()[normalizedWorkspaceKey] ?? null;
}

export function cacheWorkspaceSpritePack(workspaceKey: string, spritePackId: string): void {
  cacheWorkspaceSpritePackEntries([{ workspaceKey, spritePackId }]);
}

export function cacheProfileSpritePackAssignments(
  profiles: ProfileSpritePackAssignment[],
): void {
  const entries: SpritePackCacheEntry[] = [];

  for (const profile of profiles) {
    const spritePackId = maybeSpritePackId(profile.spritePackId);
    if (!spritePackId) continue;

    if (profile.sessionKey) {
      entries.push({ workspaceKey: profile.sessionKey, spritePackId });
    }

    if (profile.name) {
      entries.push({
        workspaceKey: buildProfileWorkspaceKey(profile.name),
        spritePackId,
      });
    }
  }

  cacheWorkspaceSpritePackEntries(entries);
}

export function subscribeSpritePackChanges(listener: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;

  const handleChange = () => listener();
  window.addEventListener(SPRITE_PACKS_UPDATED_EVENT, handleChange);
  window.addEventListener("storage", handleChange);

  return () => {
    window.removeEventListener(SPRITE_PACKS_UPDATED_EVENT, handleChange);
    window.removeEventListener("storage", handleChange);
  };
}

export function resolveSpritePackIdForWorkspace(workspaceKey: string): string {
  const stored = getStoredWorkspaceSpritePackId(workspaceKey);
  if (stored) return stored;

  const agentId = parseAgentIdFromSessionKey(workspaceKey);
  if (agentId) {
    return (
      maybeSpritePackId(agentId) ??
      BUILTIN_AGENT_SPRITE_PACKS[agentId] ??
      DEFAULT_SPRITE_PACK_ID
    );
  }

  const teamId = parseTeamTemplateIdFromSessionKey(workspaceKey);
  if (teamId) {
    return maybeSpritePackId(teamId) ?? DEFAULT_SPRITE_PACK_ID;
  }

  return DEFAULT_SPRITE_PACK_ID;
}
