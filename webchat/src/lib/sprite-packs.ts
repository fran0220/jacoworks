export interface SpritePack {
  id: string;
  name: string;
  description: string;
  gender: "male" | "female" | "neutral";
  accentColor: string;
  preview: string;
}

export const DEFAULT_SPRITE_PACK_ID = "kael";

const WORKSPACE_SPRITE_STORAGE_KEY = "jacoworks.webchat.workspace-sprite-packs.v1";
export const SPRITE_PACKS_UPDATED_EVENT = "jacoworks:sprite-packs-updated";

const BUILTIN_AGENT_SPRITE_PACKS: Record<string, string> = {
  default: "aria",
  researcher: "atlas",
  coder: "coda",
  writer: "lyric",
};

const ROLE_SPRITE_PACKS: Record<string, string> = {
  leader: "aria",
  planner: "aria",
  researcher: "atlas",
  writer: "lyric",
  reviewer: "shield",
  patrol: "beacon",
  executor: "coda",
  coder: "coda",
  member: "kael",
  default: DEFAULT_SPRITE_PACK_ID,
};

export const SPRITE_PACKS: SpritePack[] = [
  {
    id: "kael",
    name: "凯尔",
    description: "蓝金斗篷的少年冒险者",
    gender: "male",
    accentColor: "#4a6fa5",
    preview: "/sprites/kael/ref.png",
  },
  {
    id: "luna",
    name: "露娜",
    description: "披着银星长袍的月光学者",
    gender: "female",
    accentColor: "#6b4f9e",
    preview: "/sprites/luna/ref.png",
  },
  {
    id: "ember",
    name: "烬火",
    description: "赤铜火花里的铁匠工匠",
    gender: "male",
    accentColor: "#b87333",
    preview: "/sprites/ember/ref.png",
  },
  {
    id: "iris",
    name: "鸢尾",
    description: "披藤蔓花冠的花园精灵",
    gender: "female",
    accentColor: "#4a8c5c",
    preview: "/sprites/iris/ref.png",
  },
  {
    id: "zephyr",
    name: "泽风",
    description: "带着护目镜的赛博行者",
    gender: "male",
    accentColor: "#3a8c9e",
    preview: "/sprites/zephyr/ref.png",
  },
  {
    id: "yuki",
    name: "雪绘",
    description: "冰蓝发梢的冰晶巫女",
    gender: "female",
    accentColor: "#7eb8d0",
    preview: "/sprites/yuki/ref.png",
  },
  {
    id: "rex",
    name: "锐克",
    description: "披赤红披风的银甲骑士",
    gender: "male",
    accentColor: "#c0392b",
    preview: "/sprites/rex/ref.png",
  },
  {
    id: "sage",
    name: "知微",
    description: "执折扇的墨绿书院先生",
    gender: "neutral",
    accentColor: "#4a6b4a",
    preview: "/sprites/sage/ref.png",
  },
  {
    id: "coral",
    name: "珊瑚",
    description: "带望远镜的海岸航海士",
    gender: "female",
    accentColor: "#e07b5f",
    preview: "/sprites/coral/ref.png",
  },
  {
    id: "flint",
    name: "燧石",
    description: "戴头灯的矿洞探险家",
    gender: "male",
    accentColor: "#8b7d3c",
    preview: "/sprites/flint/ref.png",
  },
  {
    id: "aria",
    name: "Aria",
    description: "首席协调官 · 银发金瞳与全息徽章",
    gender: "female",
    accentColor: "#c9a227",
    preview: "/sprites/aria/ref.png",
  },
  {
    id: "nova",
    name: "Nova",
    description: "总架构师 · 深蓝马尾与电路纹风衣",
    gender: "female",
    accentColor: "#2563eb",
    preview: "/sprites/nova/ref.png",
  },
  {
    id: "echo",
    name: "Echo",
    description: "记忆管理者 · 紫发与符文兜帽",
    gender: "neutral",
    accentColor: "#a78bfa",
    preview: "/sprites/echo/ref.png",
  },
  {
    id: "coda",
    name: "Coda",
    description: "全栈工程师 · 连帽衫与腕上全息键盘",
    gender: "male",
    accentColor: "#78716c",
    preview: "/sprites/coda/ref.png",
  },
  {
    id: "hex",
    name: "Hex",
    description: "系统黑客 · 绿光单片镜与机能夹克",
    gender: "neutral",
    accentColor: "#22c55e",
    preview: "/sprites/hex/ref.png",
  },
  {
    id: "patch",
    name: "Patch",
    description: "修复专家 · 工具腰带与发光扳手",
    gender: "neutral",
    accentColor: "#ea580c",
    preview: "/sprites/patch/ref.png",
  },
  {
    id: "byte",
    name: "Byte",
    description: "数据工程师 · 指间数据流",
    gender: "male",
    accentColor: "#3b82f6",
    preview: "/sprites/byte/ref.png",
  },
  {
    id: "pixel",
    name: "Pixel",
    description: "前端匠人 · 猫耳耳机与街头穿搭",
    gender: "neutral",
    accentColor: "#ec4899",
    preview: "/sprites/pixel/ref.png",
  },
  {
    id: "muse",
    name: "Muse",
    description: "创意总监 · 酒红长发与贝雷帽",
    gender: "female",
    accentColor: "#9f1239",
    preview: "/sprites/muse/ref.png",
  },
  {
    id: "sketch",
    name: "Sketch",
    description: "视觉设计师 · 牛仔围裙与触控笔",
    gender: "neutral",
    accentColor: "#6366f1",
    preview: "/sprites/sketch/ref.png",
  },
  {
    id: "lyric",
    name: "Lyric",
    description: "文案大师 · 银发与咖啡棕外套",
    gender: "neutral",
    accentColor: "#b45309",
    preview: "/sprites/lyric/ref.png",
  },
  {
    id: "render",
    name: "Render",
    description: "3D 艺术家 · 剃鬓角与 AR 手套",
    gender: "neutral",
    accentColor: "#0d9488",
    preview: "/sprites/render/ref.png",
  },
  {
    id: "chord",
    name: "Chord",
    description: "音频工程师 · 脏辫与紫色飞行夹克",
    gender: "neutral",
    accentColor: "#7c3aed",
    preview: "/sprites/chord/ref.png",
  },
  {
    id: "atlas",
    name: "Atlas",
    description: "知识探索者 · 皮大衣与地图挎包",
    gender: "neutral",
    accentColor: "#92400e",
    preview: "/sprites/atlas/ref.png",
  },
  {
    id: "savant",
    name: "Sage",
    description: "深度分析师 · 墨绿短发与星盘胸针",
    gender: "neutral",
    accentColor: "#166534",
    preview: "/sprites/savant/ref.png",
  },
  {
    id: "prism",
    name: "Prism",
    description: "数据可视化师 · 彩虹短发与实验袍",
    gender: "neutral",
    accentColor: "#8b5cf6",
    preview: "/sprites/prism/ref.png",
  },
  {
    id: "oracle",
    name: "Oracle",
    description: "预测分析师 · 和服式科技长袍与星图",
    gender: "neutral",
    accentColor: "#1e3a8a",
    preview: "/sprites/oracle/ref.png",
  },
  {
    id: "shield",
    name: "Shield",
    description: "安全守卫 · 战术夹克与臂上能量盾",
    gender: "male",
    accentColor: "#64748b",
    preview: "/sprites/shield/ref.png",
  },
  {
    id: "beacon",
    name: "Beacon",
    description: "监控哨兵 · 黄发与肩侧无人机",
    gender: "neutral",
    accentColor: "#eab308",
    preview: "/sprites/beacon/ref.png",
  },
  {
    id: "forge",
    name: "Forge",
    description: "基础设施 · 工装与焊接护目镜",
    gender: "neutral",
    accentColor: "#c2410c",
    preview: "/sprites/forge/ref.png",
  },
  {
    id: "sync",
    name: "Sync",
    description: "协作协调员 · 双色发与全息平板",
    gender: "neutral",
    accentColor: "#64748b",
    preview: "/sprites/sync/ref.png",
  },
  {
    id: "tempo",
    name: "Tempo",
    description: "项目调度 · 双表腕与修身西装",
    gender: "neutral",
    accentColor: "#1e293b",
    preview: "/sprites/tempo/ref.png",
  },
  {
    id: "scroll",
    name: "Scroll",
    description: "文档管理 · 针织开衫与发光书册",
    gender: "neutral",
    accentColor: "#a16207",
    preview: "/sprites/scroll/ref.png",
  },
  {
    id: "link",
    name: "Link",
    description: "API 联络官 · 双手光束连接",
    gender: "neutral",
    accentColor: "#16a34a",
    preview: "/sprites/link/ref.png",
  },
  {
    id: "vox",
    name: "Vox",
    description: "语音交互 · 金卷发与声波腰带",
    gender: "female",
    accentColor: "#34d399",
    preview: "/sprites/vox/ref.png",
  },
  {
    id: "lens",
    name: "Lens",
    description: "视觉识别 · 红片 AR 镜与摄影背心",
    gender: "neutral",
    accentColor: "#dc2626",
    preview: "/sprites/lens/ref.png",
  },
  {
    id: "spark",
    name: "Spark",
    description: "快速原型 · 闪电卫衣与高能量姿态",
    gender: "neutral",
    accentColor: "#f97316",
    preview: "/sprites/spark/ref.png",
  },
  {
    id: "ghost",
    name: "Ghost",
    description: "后台进程 · 半透明披风与雾感轮廓",
    gender: "neutral",
    accentColor: "#94a3b8",
    preview: "/sprites/ghost/ref.png",
  },
  {
    id: "rune",
    name: "Rune",
    description: "自动化脚本 · 额前符文与臂上代码屏",
    gender: "neutral",
    accentColor: "#1d4ed8",
    preview: "/sprites/rune/ref.png",
  },
  {
    id: "core",
    name: "Core",
    description: "系统内核 · 白发光瞳与胸前能量球",
    gender: "neutral",
    accentColor: "#e0f2fe",
    preview: "/sprites/core/ref.png",
  },
];

const SPRITE_PACKS_BY_ID = new Map(SPRITE_PACKS.map((pack) => [pack.id, pack]));

interface SpritePackCacheEntry {
  workspaceKey: string;
  spritePackId: string;
}

interface ProfileSpritePackAssignment {
  name?: string | null;
  sessionKey?: string | null;
  spritePackId?: string | null;
}

function normalizeId(value?: string | null): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

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
      Object.entries(parsed as Record<string, unknown>).flatMap(([workspaceKey, spritePackId]) => {
        const normalizedWorkspaceKey = normalizeWorkspaceKey(workspaceKey);
        const normalizedSpritePackId = maybeSpritePackId(spritePackId);
        if (!normalizedWorkspaceKey || !normalizedSpritePackId) return [];
        return [[normalizedWorkspaceKey, normalizedSpritePackId]];
      }),
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

export function buildSpriteSheetPath(
  spritePackId: string,
  expression: "idle" | "thinking" | "speaking" | "working" | "happy" | "error",
): string {
  return `/sprites/${resolveSpritePackId(spritePackId)}/${expression}.png`;
}

export function buildSpriteReferencePath(spritePackId: string): string {
  return `/sprites/${resolveSpritePackId(spritePackId)}/ref.png`;
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
      entries.push({ workspaceKey: buildProfileWorkspaceKey(profile.name), spritePackId });
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
    return maybeSpritePackId(agentId) ?? BUILTIN_AGENT_SPRITE_PACKS[agentId] ?? DEFAULT_SPRITE_PACK_ID;
  }

  const teamId = parseTeamTemplateIdFromSessionKey(workspaceKey);
  if (teamId) {
    return maybeSpritePackId(teamId) ?? DEFAULT_SPRITE_PACK_ID;
  }

  return DEFAULT_SPRITE_PACK_ID;
}
