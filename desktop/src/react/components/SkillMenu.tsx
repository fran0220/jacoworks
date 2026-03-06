import { ChevronRight } from "lucide-react";
import { useMemo } from "react";
import { useSkills } from "../lib/skills";

export default function SkillMenu({
  onSelect,
}: {
  onSelect: (skillId: string) => void;
}) {
  const skills = useSkills();
  const grouped = useMemo(() => {
    const map = new Map<string, typeof skills>();
    for (const s of skills) {
      const g = s.group || "";
      if (!map.has(g)) map.set(g, []);
      map.get(g)!.push(s);
    }
    return map;
  }, [skills]);

  if (skills.length === 0) return null;

  const ungrouped = grouped.get("") || [];
  const groups = Array.from(grouped.entries()).filter(([g]) => g !== "");

  return (
    <>
      {ungrouped.map((skill) => (
        <button
          key={skill.id}
          className="sk-item"
          onClick={() => onSelect(skill.id)}
        >
          {skill.name}
        </button>
      ))}

      {groups.map(([group, items]) => (
        <div key={group} className="sk-flyout">
          <div className="sk-flyout-trigger">
            <span>{group}</span>
            <ChevronRight size={12} className="sk-flyout-arrow" />
          </div>
          <div className="sk-flyout-panel">
            {items.map((skill) => (
              <button
                key={skill.id}
                className="sk-item"
                onClick={() => onSelect(skill.id)}
              >
                {skill.name}
              </button>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}
