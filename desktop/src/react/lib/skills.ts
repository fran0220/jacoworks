import { useState, useEffect } from "react";

export interface SkillDefinition {
  id: string;
  name: string;
  description: string;
  group?: string;
  source: "builtin" | "user";
  editable: boolean;
}

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
