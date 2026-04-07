export interface SpritePack {
  id: string;
  name: string;
  description: string;
  gender: "male" | "female" | "neutral";
  accentColor: string;
  preview: string;
}

export interface ProfileSpritePackAssignment {
  name?: string | null;
  sessionKey?: string | null;
  spritePackId?: string | null;
}

export interface SpritePackCacheEntry {
  workspaceKey: string;
  spritePackId: string;
}
