import { useState, useEffect } from "react";
import { getToken } from "./auth";
import { GATEWAY_URL } from "./config";
import { httpFetch } from "./transport";

export interface SkillDefinition {
  id: string;
  name: string;
  description: string;
  group?: string;
  source: "builtin" | "user";
  editable: boolean;
  file_count?: number;
}

// ─── In-memory cache + reactive listeners ────────────────

let cached: SkillDefinition[] = [];
const listeners = new Set<() => void>();

export function setSkills(skills: SkillDefinition[]) {
  cached = skills;
  for (const fn of listeners) fn();
}

export function useSkills(): SkillDefinition[] {
  const [skills, setLocal] = useState(cached);
  useEffect(() => {
    const fn = () => setLocal([...cached]);
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  }, []);
  return skills;
}

// ─── Gateway API ─────────────────────────────────────────

/** GET /api/skills — fetch system + user skill summaries from gateway DB. */
export async function fetchSkills(): Promise<SkillDefinition[]> {
  const token = getToken();
  if (!token) return [];

  const res = await httpFetch(`${GATEWAY_URL}/api/skills`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });

  if (res.status !== 200) {
    console.warn("[skills] fetch failed:", res.status);
    return [];
  }

  const data = JSON.parse(res.body) as { skills: SkillDefinition[] };
  return data.skills ?? [];
}

/** PUT /api/skills/{skillId} — create or update a user skill. */
export async function saveSkill(
  id: string,
  files: { path: string; content: string }[],
): Promise<void> {
  const token = getToken();
  if (!token) throw new Error("未登录");

  const res = await httpFetch(`${GATEWAY_URL}/api/skills/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ files }),
  });

  if (res.status !== 200) {
    const data = JSON.parse(res.body);
    throw new Error(data.error || `保存技能失败: ${res.status}`);
  }
}

/** DELETE /api/skills/{skillId} — delete a user skill. */
export async function deleteSkill(id: string): Promise<void> {
  const token = getToken();
  if (!token) throw new Error("未登录");

  const res = await httpFetch(`${GATEWAY_URL}/api/skills/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });

  if (res.status !== 200) {
    const data = JSON.parse(res.body);
    throw new Error(data.error || `删除技能失败: ${res.status}`);
  }
}
