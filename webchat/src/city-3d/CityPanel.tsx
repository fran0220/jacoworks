import { useEffect, useRef, useState, useCallback } from "react";
import * as THREE from "three";
import { CityScene } from "./CityScene";
import { CityEnvironment } from "./CityEnvironment";
import { CityWaypointGraph } from "./navigation/CityWaypointGraph";
import { getRoleHomeZone, getZone3D, getCityZones3D, type CityZoneId } from "./navigation/zone-mapping";
import { AgentTrail } from "./fx/agent-trail";
import { CollaborationBeam } from "./fx/collaboration-beam";
import { AvatarPool } from "../observatory/avatar/AvatarPool";
import { AvatarAnimator } from "../observatory/avatar/AvatarAnimator";
import { AvatarNavigator } from "../observatory/avatar/AvatarNavigator";
import { getRoleConfig, type WorldAgent, type AgentState } from "../observatory/types";

// ── Types ────────────────────────────────────────────────

interface ManagedAgent {
  agent: WorldAgent;
  animator: AvatarAnimator;
  navigator: AvatarNavigator;
  trail: AgentTrail;
}

interface CityPanelProps {
  className?: string;
}

// ── Demo agent definitions ───────────────────────────────

const DEMO_AGENTS = [
  { id: "agent-planner",    name: "玲策划", role: "planner" },
  { id: "agent-executor-1", name: "凯构建", role: "executor" },
  { id: "agent-executor-2", name: "凯执行", role: "executor" },
  { id: "agent-reviewer",   name: "言审阅", role: "reviewer" },
  { id: "agent-patrol",     name: "夜巡查", role: "patrol" },
  { id: "agent-researcher", name: "知探究", role: "researcher" },
  { id: "agent-writer",     name: "文撰写", role: "writer" },
  { id: "agent-member",     name: "协同员", role: "member" },
] as const;

// ── Helpers ──────────────────────────────────────────────

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function pickRandom<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

const ALL_ZONE_IDS: CityZoneId[] = getCityZones3D().map((z) => z.id);

// ── Component ────────────────────────────────────────────

export default function CityPanel({ className }: CityPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<CityScene | null>(null);
  const environmentRef = useRef<CityEnvironment | null>(null);
  const waypointGraphRef = useRef<CityWaypointGraph | null>(null);
  const avatarPoolRef = useRef<AvatarPool | null>(null);
  const agentsRef = useRef<Map<string, ManagedAgent>>(new Map());
  const collaborationRef = useRef<CollaborationBeam | null>(null);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const [loading, setLoading] = useState(true);
  const [activeAgentCount, setActiveAgentCount] = useState(0);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [latestEvent, setLatestEvent] = useState("");

  // Suppress unused-var lint — setSelectedAgentId will be wired to click interaction
  void setSelectedAgentId;

  // ── Spawn demo agents ────────────────────────────────

  const spawnDemoAgents = useCallback(() => {
    const scene = sceneRef.current;
    const pool = avatarPoolRef.current;
    const graph = waypointGraphRef.current;
    if (!scene || !pool || !graph) return;

    for (const def of DEMO_AGENTS) {
      const config = getRoleConfig(def.role);
      const mesh = pool.getFallbackMesh(def.role);
      const homeZoneId = getRoleHomeZone(def.role);
      const zone = getZone3D(homeZoneId);
      const slot = zone.slots[Math.floor(Math.random() * zone.slots.length)];
      const spawnPos = slot.clone();

      mesh.position.copy(spawnPos);
      scene.getScene().add(mesh);

      const mixer = new THREE.AnimationMixer(mesh);

      const agent: WorldAgent = {
        id: def.id,
        name: def.name,
        role: def.role,
        config,
        root: mesh,
        state: "idle",
        position: spawnPos,
        targetZone: null,
        walkPath: [],
        walkSpeed: 2.5,
        currentSlot: null,
        score: 0,
        currentTask: null,
        lastActivity: Date.now(),
      };

      const animator = new AvatarAnimator(mesh, mixer);
      const navigator = new AvatarNavigator(agent);
      const trail = new AgentTrail(scene.getScene(), config.color);

      agentsRef.current.set(def.id, { agent, animator, navigator, trail });
    }

    setActiveAgentCount(DEMO_AGENTS.length);
  }, []);

  // ── Agent behavior scheduling ────────────────────────

  const scheduleAgentBehavior = useCallback(() => {
    const graph = waypointGraphRef.current;
    if (!graph) return;

    // Movement scheduling: every 5-8s, pick a random agent to move
    const scheduleMoveLoop = () => {
      const delay = randomBetween(5000, 8000);
      const timer = setTimeout(() => {
        const agents = Array.from(agentsRef.current.values());
        const idleAgents = agents.filter(
          (m) => m.agent.state === "idle" || m.agent.state === "working" || m.agent.state === "thinking",
        );
        if (idleAgents.length > 0) {
          const managed = pickRandom(idleAgents);
          const currentZone = getRoleHomeZone(managed.agent.role);
          let targetZone: CityZoneId;
          do {
            targetZone = pickRandom(ALL_ZONE_IDS);
          } while (targetZone === currentZone && ALL_ZONE_IDS.length > 1);

          const path = graph.findPath(managed.agent.position, targetZone);
          if (path.length > 1) {
            managed.navigator.setDestination(path);
            managed.agent.state = "walking";
            managed.animator.setState("walking");
            managed.agent.targetZone = targetZone as unknown as typeof managed.agent.targetZone;
            const zoneLabel = getZone3D(targetZone).label;
            setLatestEvent(`${managed.agent.name} → ${zoneLabel}`);
          }
        }
        scheduleMoveLoop();
      }, delay);
      timersRef.current.push(timer);
    };

    // Patrol agent: start on patrol ring immediately
    const patrolManaged = agentsRef.current.get("agent-patrol");
    if (patrolManaged && graph) {
      const patrolPath = graph.getPatrolPath(patrolManaged.agent.position);
      if (patrolPath.length > 1) {
        patrolManaged.navigator.setDestination(patrolPath);
        patrolManaged.agent.state = "patrolling";
        patrolManaged.animator.setState("patrolling");
      }
    }

    // Collaboration beam scheduling: every 10-15s
    const scheduleBeamLoop = () => {
      const delay = randomBetween(10000, 15000);
      const timer = setTimeout(() => {
        const agents = Array.from(agentsRef.current.values());
        if (agents.length >= 2) {
          const a = pickRandom(agents);
          let b: ManagedAgent;
          do {
            b = pickRandom(agents);
          } while (b.agent.id === a.agent.id);

          const beamId = `beam-${Date.now()}`;
          const color = a.agent.config.color;
          collaborationRef.current?.connect(a.agent.position, b.agent.position, color, beamId);
          setLatestEvent(`${a.agent.name} ↔ ${b.agent.name} 协作中`);
          const beamTimer = setTimeout(() => {
            collaborationRef.current?.disconnect(beamId);
          }, 5000);
          timersRef.current.push(beamTimer);
        }
        scheduleBeamLoop();
      }, delay);
      timersRef.current.push(timer);
    };

    scheduleMoveLoop();
    scheduleBeamLoop();
  }, []);

  // ── Per-frame update ─────────────────────────────────

  const updateAgents = useCallback((delta: number, _elapsed: number) => {
    for (const managed of agentsRef.current.values()) {
      managed.animator.update(delta);
      const isMoving = managed.navigator.update(delta);

      if (isMoving) {
        managed.trail.addPoint(managed.agent.position);
      } else if (managed.agent.state === "walking") {
        // Arrived at destination
        const nextState: AgentState = Math.random() > 0.5 ? "working" : "thinking";
        managed.agent.state = nextState;
        managed.animator.setState(nextState);

        // Schedule return to idle
        const idleDelay = randomBetween(5000, 10000);
        const timer = setTimeout(() => {
          if (agentsRef.current.has(managed.agent.id)) {
            managed.agent.state = "idle";
            managed.animator.setState("idle");
          }
        }, idleDelay);
        timersRef.current.push(timer);
      } else if (managed.agent.state === "patrolling" && !isMoving) {
        // Patrol agent completed circuit, restart
        const graph = waypointGraphRef.current;
        if (graph) {
          const patrolPath = graph.getPatrolPath(managed.agent.position);
          if (patrolPath.length > 1) {
            managed.navigator.setDestination(patrolPath);
          }
        }
      }

      managed.trail.update(delta);
    }
  }, []);

  // ── Initialization ───────────────────────────────────

  useEffect(() => {
    if (!containerRef.current) return;

    const cityScene = new CityScene();
    cityScene.mount(containerRef.current);
    sceneRef.current = cityScene;

    const environment = new CityEnvironment(cityScene.getScene());
    environmentRef.current = environment;

    waypointGraphRef.current = new CityWaypointGraph();
    avatarPoolRef.current = new AvatarPool();
    collaborationRef.current = new CollaborationBeam(cityScene.getScene());

    environment.load("/city-data/yizhuang.json").then(() => {
      setLoading(false);
      spawnDemoAgents();
      scheduleAgentBehavior();
    });

    cityScene.setOnUpdate((delta, elapsed) => {
      environment.update(elapsed, delta);
      updateAgents(delta, elapsed);
      collaborationRef.current?.update(elapsed, delta);
    });

    const ro = new ResizeObserver(() => cityScene.resize());
    ro.observe(containerRef.current);

    return () => {
      for (const timer of timersRef.current) clearTimeout(timer);
      timersRef.current = [];
      ro.disconnect();
      cityScene.dispose();
      environment.dispose();
      collaborationRef.current?.dispose();
      for (const managed of agentsRef.current.values()) {
        managed.trail.dispose();
      }
      agentsRef.current.clear();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Render ───────────────────────────────────────────

  return (
    <div
      className={`city-3d-panel ${className ?? ""}`}
      style={{ position: "relative", width: "100%", height: "100%" }}
    >
      <div ref={containerRef} style={{ width: "100%", height: "100%" }} />

      {loading && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(2, 8, 23, 0.9)",
            color: "#06b6d4",
            fontSize: "14px",
            fontFamily: "monospace",
          }}
        >
          <div>
            <div style={{ marginBottom: 8, fontSize: 18 }}>数字之城加载中...</div>
            <div style={{ opacity: 0.6 }}>正在构建亦庄 3D 城市场景</div>
          </div>
        </div>
      )}

      {!loading && (
        <div
          style={{
            position: "absolute",
            top: 16,
            left: 16,
            pointerEvents: "none",
            color: "#e0f2fe",
            fontFamily: "monospace",
            fontSize: 12,
          }}
        >
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>
            亦庄数字之城
          </div>
          <div style={{ opacity: 0.7 }}>活跃 Agent: {activeAgentCount}</div>
          {selectedAgentId && (
            <div style={{ marginTop: 4, opacity: 0.8, color: "#38bdf8" }}>
              选中: {agentsRef.current.get(selectedAgentId)?.agent.name ?? selectedAgentId}
            </div>
          )}
          {latestEvent && (
            <div style={{ marginTop: 8, opacity: 0.5, maxWidth: 260 }}>
              {latestEvent}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
