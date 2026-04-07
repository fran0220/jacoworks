import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Sparkles, Users } from "lucide-react";
import { buildSpriteSheetPath } from "../lib/sprite-packs";
import { mapVillageStateToExpression, type VillageAgentState } from "../village/VillageAgent";

interface CityAgent {
  id: string;
  userName: string;
  agentName: string;
  role: string;
  state: VillageAgentState;
  spritePackId: string;
  position: { x: number; y: number };
  zoneId: string;
}

interface CityZone {
  id: string;
  label: string;
  icon: string;
  position: { x: number; y: number };
  size: { w: number; h: number };
  accent: string;
}

const ZONES: CityZone[] = [
  { id: "office", label: "办公区", icon: "🏢", position: { x: 10, y: 15 }, size: { w: 25, h: 30 }, accent: "#60a5fa" },
  { id: "market", label: "商业区", icon: "🏪", position: { x: 40, y: 10 }, size: { w: 22, h: 25 }, accent: "#f59e0b" },
  { id: "residential", label: "住宅区", icon: "🏠", position: { x: 68, y: 12 }, size: { w: 25, h: 28 }, accent: "#34d399" },
  { id: "park", label: "公园", icon: "🌳", position: { x: 15, y: 55 }, size: { w: 28, h: 25 }, accent: "#86efac" },
  { id: "studio", label: "创意工坊", icon: "🎨", position: { x: 48, y: 50 }, size: { w: 22, h: 28 }, accent: "#c084fc" },
  { id: "datacenter", label: "数据中心", icon: "🖥️", position: { x: 75, y: 50 }, size: { w: 20, h: 30 }, accent: "#22d3ee" },
];

const MOCK_AGENTS: CityAgent[] = [
  { id: "u1-a1", userName: "Alice", agentName: "研究员", role: "researcher", state: "working", spritePackId: "kael", position: { x: 18, y: 25 }, zoneId: "office" },
  { id: "u1-a2", userName: "Alice", agentName: "写手", role: "writer", state: "thinking", spritePackId: "mira", position: { x: 52, y: 58 }, zoneId: "studio" },
  { id: "u2-a1", userName: "Bob", agentName: "工程师", role: "coder", state: "working", spritePackId: "rex", position: { x: 78, y: 60 }, zoneId: "datacenter" },
  { id: "u2-a2", userName: "Bob", agentName: "规划师", role: "planner", state: "idle", spritePackId: "nyx", position: { x: 22, y: 62 }, zoneId: "park" },
  { id: "u3-a1", userName: "Carol", agentName: "分析师", role: "executor", state: "reviewing", spritePackId: "kael", position: { x: 45, y: 18 }, zoneId: "market" },
  { id: "u3-a2", userName: "Carol", agentName: "审查员", role: "reviewer", state: "working", spritePackId: "mira", position: { x: 15, y: 20 }, zoneId: "office" },
  { id: "u4-a1", userName: "Dave", agentName: "巡逻兵", role: "patrol", state: "walking", spritePackId: "rex", position: { x: 72, y: 20 }, zoneId: "residential" },
  { id: "u4-a2", userName: "Dave", agentName: "设计师", role: "writer", state: "celebrating", spritePackId: "nyx", position: { x: 55, y: 55 }, zoneId: "studio" },
  { id: "u5-a1", userName: "Eve", agentName: "协调员", role: "planner", state: "thinking", spritePackId: "kael", position: { x: 80, y: 55 }, zoneId: "datacenter" },
  { id: "u6-a1", userName: "Frank", agentName: "运营", role: "executor", state: "working", spritePackId: "mira", position: { x: 48, y: 15 }, zoneId: "market" },
];

const STORIES = [
  "Alice 的研究员正在办公区整理调研报告…",
  "Bob 的工程师在数据中心完成了一次代码部署",
  "Carol 的分析师和 Frank 的运营在商业区讨论方案",
  "Dave 的巡逻兵正在住宅区和公园之间巡逻",
  "Eve 的协调员在数据中心思考下一步计划",
  "Alice 的写手在创意工坊写了一篇文章，Dave 的设计师正在配图",
  "Bob 的规划师在公园散步休息，即将返回办公区",
  "Carol 的审查员完成了代码审查，准备提交报告",
];

function randomInRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function moveAgentInZone(agent: CityAgent): CityAgent {
  const zone = ZONES.find((z) => z.id === agent.zoneId);
  if (!zone) return agent;

  const STATES: VillageAgentState[] = ["working", "thinking", "idle", "reviewing", "celebrating"];

  // Occasionally move to a different zone
  if (Math.random() < 0.15) {
    const otherZones = ZONES.filter((z) => z.id !== agent.zoneId);
    const target = otherZones[Math.floor(Math.random() * otherZones.length)];
    return {
      ...agent,
      zoneId: target.id,
      state: "walking",
      position: {
        x: randomInRange(target.position.x + 2, target.position.x + target.size.w - 4),
        y: randomInRange(target.position.y + 4, target.position.y + target.size.h - 4),
      },
    };
  }

  // Small movement within zone
  return {
    ...agent,
    state: Math.random() < 0.3 ? STATES[Math.floor(Math.random() * STATES.length)] : agent.state,
    position: {
      x: Math.max(zone.position.x + 2, Math.min(zone.position.x + zone.size.w - 4, agent.position.x + (Math.random() - 0.5) * 4)),
      y: Math.max(zone.position.y + 4, Math.min(zone.position.y + zone.size.h - 4, agent.position.y + (Math.random() - 0.5) * 4)),
    },
  };
}

export default function DigitalCityView() {
  const [agents, setAgents] = useState<CityAgent[]>(MOCK_AGENTS);
  const [story, setStory] = useState(STORIES[0]);
  const storyIndexRef = useRef(0);

  useEffect(() => {
    const moveTimer = window.setInterval(() => {
      setAgents((prev) => prev.map(moveAgentInZone));
    }, 3000);

    const storyTimer = window.setInterval(() => {
      storyIndexRef.current = (storyIndexRef.current + 1) % STORIES.length;
      setStory(STORIES[storyIndexRef.current]);
    }, 5000);

    return () => {
      window.clearInterval(moveTimer);
      window.clearInterval(storyTimer);
    };
  }, []);

  const activeCount = useMemo(
    () => agents.filter((a) => a.state !== "idle").length,
    [agents],
  );

  const zoneCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const agent of agents) {
      counts[agent.zoneId] = (counts[agent.zoneId] ?? 0) + 1;
    }
    return counts;
  }, [agents]);

  return (
    <div className="city-view">
      <div className="city-canvas">
        {/* Zone areas */}
        {ZONES.map((zone) => (
          <div
            key={zone.id}
            className="city-zone"
            style={{
              left: `${zone.position.x}%`,
              top: `${zone.position.y}%`,
              width: `${zone.size.w}%`,
              height: `${zone.size.h}%`,
              "--zone-accent": zone.accent,
            } as CSSProperties}
          >
            <div className="city-zone-label">
              <span>{zone.icon}</span>
              <strong>{zone.label}</strong>
              <em>{zoneCounts[zone.id] ?? 0}</em>
            </div>
          </div>
        ))}

        {/* Agent sprites */}
        {agents.map((agent) => {
          const expression = mapVillageStateToExpression(agent.state);
          return (
            <div
              key={agent.id}
              className={`city-agent city-agent--${agent.state}`}
              style={{
                left: `${agent.position.x}%`,
                top: `${agent.position.y}%`,
              }}
            >
              <div className="city-agent-bubble">
                <strong>{agent.userName}</strong>
                <span>{agent.agentName}</span>
              </div>
              <div
                className={`city-agent-sprite city-agent-sprite--${expression}`}
                style={{ backgroundImage: `url(${buildSpriteSheetPath(agent.spritePackId, expression)})` }}
              />
            </div>
          );
        })}
      </div>

      <div className="city-status-bar">
        <span className="city-status-item">
          <Users size={14} />
          <span>人口 {agents.length}</span>
        </span>
        <span className="city-status-item">
          <Sparkles size={14} />
          <span>活跃 {activeCount}</span>
        </span>
        <span className="city-status-story">{story}</span>
      </div>
    </div>
  );
}
