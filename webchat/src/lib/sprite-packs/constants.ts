export const DEFAULT_SPRITE_PACK_ID = "kael";

export const SPRITE_PACKS_UPDATED_EVENT = "jacoworks:sprite-packs-updated";

export const WORKSPACE_SPRITE_STORAGE_KEY =
  "jacoworks.webchat.workspace-sprite-packs.v1";

export const BUILTIN_AGENT_SPRITE_PACKS: Record<string, string> = {
  default: "aria",
  researcher: "echo",
  coder: "coda",
  writer: "lyric",
  analyst: "nova",
  designer: "sketch",
  planner: "nova",
  secretary: "echo",
};

export const ROLE_SPRITE_PACKS: Record<string, string> = {
  leader: "aria",
  planner: "aria",
  researcher: "echo",
  writer: "lyric",
  reviewer: "hex",
  patrol: "rex",
  executor: "coda",
  coder: "coda",
  analyst: "nova",
  designer: "sketch",
  secretary: "echo",
  summarizer: "lyric",
  member: "kael",
  default: DEFAULT_SPRITE_PACK_ID,
};
