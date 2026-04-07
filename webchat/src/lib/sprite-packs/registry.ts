import {
  DEFAULT_SPRITE_PACK_ID,
  ROLE_SPRITE_PACKS,
} from "./constants";
import { SPRITE_PACKS } from "./data";
import type { SpritePack } from "./types";

const SPRITE_PACKS_BY_ID = new Map(SPRITE_PACKS.map((pack) => [pack.id, pack]));

function normalizeId(value?: string | null): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function maybeSpritePackId(value?: unknown): string | null {
  const normalized = normalizeId(typeof value === "string" ? value : null);
  return normalized && SPRITE_PACKS_BY_ID.has(normalized) ? normalized : null;
}

export function resolveSpritePackId(value?: string | null): string {
  return maybeSpritePackId(value) ?? DEFAULT_SPRITE_PACK_ID;
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function pickSpritePackIdFromSeed(seed: string): string {
  const list = SPRITE_PACKS;
  if (!list.length) return DEFAULT_SPRITE_PACK_ID;
  const normalized = seed.trim().toLowerCase();
  if (!normalized) return DEFAULT_SPRITE_PACK_ID;
  const index = hashString(normalized) % list.length;
  return list[index]?.id ?? DEFAULT_SPRITE_PACK_ID;
}

export function resolveSpritePackIdForRole(role?: string | null): string {
  const normalized = typeof role === "string" ? role.trim().toLowerCase() : "";
  if (!normalized) return DEFAULT_SPRITE_PACK_ID;
  return ROLE_SPRITE_PACKS[normalized] ?? DEFAULT_SPRITE_PACK_ID;
}

export function getSpritePack(id?: string | null): SpritePack {
  return SPRITE_PACKS_BY_ID.get(resolveSpritePackId(id)) ?? SPRITE_PACKS[0];
}
