import type { SpritePack } from "./types";

const SPRITES_BASE_URL = import.meta.env.BASE_URL.replace(/\/$/, "");

interface SpritePackSeed {
  id: string;
  name: string;
  description: string;
  gender: "male" | "female" | "neutral";
  accentColor: string;
}

const SPRITE_PACK_SEEDS: SpritePackSeed[] = [
  {
    id: "kael",
    name: "凯尔",
    description: "蓝金斗篷的少年冒险者",
    gender: "male",
    accentColor: "#4a6fa5",
  },
  {
    id: "luna",
    name: "露娜",
    description: "披着银星长袍的月光学者",
    gender: "female",
    accentColor: "#6b4f9e",
  },
  {
    id: "ember",
    name: "烬火",
    description: "赤铜火花里的铁匠工匠",
    gender: "male",
    accentColor: "#b87333",
  },

  {
    id: "zephyr",
    name: "泽风",
    description: "带着护目镜的赛博行者",
    gender: "male",
    accentColor: "#3a8c9e",
  },

  {
    id: "rex",
    name: "锐克",
    description: "披赤红披风的银甲骑士",
    gender: "male",
    accentColor: "#c0392b",
  },

  {
    id: "coral",
    name: "珊瑚",
    description: "带望远镜的海岸航海士",
    gender: "female",
    accentColor: "#e07b5f",
  },

  {
    id: "aria",
    name: "Aria",
    description: "首席协调官 · 银发金瞳与全息徽章",
    gender: "female",
    accentColor: "#c9a227",
  },
  {
    id: "nova",
    name: "Nova",
    description: "总架构师 · 深蓝马尾与电路纹风衣",
    gender: "female",
    accentColor: "#2563eb",
  },
  {
    id: "echo",
    name: "Echo",
    description: "记忆管理者 · 紫发与符文兜帽",
    gender: "neutral",
    accentColor: "#a78bfa",
  },
  {
    id: "coda",
    name: "Coda",
    description: "全栈工程师 · 连帽衫与腕上全息键盘",
    gender: "male",
    accentColor: "#78716c",
  },
  {
    id: "hex",
    name: "Hex",
    description: "系统黑客 · 绿光单片镜与机能夹克",
    gender: "neutral",
    accentColor: "#22c55e",
  },
  {
    id: "patch",
    name: "Patch",
    description: "修复专家 · 工具腰带与发光扳手",
    gender: "neutral",
    accentColor: "#ea580c",
  },
  {
    id: "byte",
    name: "Byte",
    description: "数据工程师 · 指间数据流",
    gender: "male",
    accentColor: "#3b82f6",
  },
  {
    id: "pixel",
    name: "Pixel",
    description: "前端匠人 · 猫耳耳机与街头穿搭",
    gender: "neutral",
    accentColor: "#ec4899",
  },
  {
    id: "muse",
    name: "Muse",
    description: "创意总监 · 酒红长发与贝雷帽",
    gender: "female",
    accentColor: "#9f1239",
  },
  {
    id: "sketch",
    name: "Sketch",
    description: "视觉设计师 · 牛仔围裙与触控笔",
    gender: "neutral",
    accentColor: "#6366f1",
  },
  {
    id: "lyric",
    name: "Lyric",
    description: "文案大师 · 银发与咖啡棕外套",
    gender: "neutral",
    accentColor: "#b45309",
  },
  {
    id: "render",
    name: "Render",
    description: "3D 艺术家 · 剃鬓角与 AR 手套",
    gender: "neutral",
    accentColor: "#0d9488",
  },
  {
    id: "chord",
    name: "Chord",
    description: "音频工程师 · 脏辫与紫色飞行夹克",
    gender: "neutral",
    accentColor: "#7c3aed",
  },

];

export const SPRITE_PACKS: SpritePack[] = SPRITE_PACK_SEEDS.map((seed) => ({
  ...seed,
  preview: `${SPRITES_BASE_URL}/sprites/${seed.id}/ref.png`,
}));
