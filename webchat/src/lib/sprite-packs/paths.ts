import { DEFAULT_SPRITE_PACK_ID } from "./constants";

export const SPRITES_BASE_URL = import.meta.env.BASE_URL.replace(/\/$/, "");

export type SpriteExpression =
  | "idle"
  | "thinking"
  | "speaking"
  | "working"
  | "happy"
  | "error";

function normalizeSpriteId(id?: string | null): string {
  const trimmed = typeof id === "string" ? id.trim().toLowerCase() : "";
  return trimmed || DEFAULT_SPRITE_PACK_ID;
}

export function buildSpriteSheetPath(
  spritePackId: string,
  expression: SpriteExpression,
): string {
  return `${SPRITES_BASE_URL}/sprites/${normalizeSpriteId(spritePackId)}/${expression}.png`;
}

export function buildSpriteReferencePath(spritePackId: string): string {
  return `${SPRITES_BASE_URL}/sprites/${normalizeSpriteId(spritePackId)}/ref.png`;
}
