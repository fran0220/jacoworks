import { DEFAULT_SPRITE_PACK_ID } from "../../lib/sprite-packs";
import type { ProfileDetail } from "../../lib/teams";

export function createBlankProfileDetail(): ProfileDetail {
  return {
    type: "agent",
    name: "",
    displayName: "",
    description: "",
    icon: "bot",
    model: "proxy/gpt-5.4",
    skills: [],
    workspace: "",
    files: {},
    spritePackId: DEFAULT_SPRITE_PACK_ID,
  };
}
