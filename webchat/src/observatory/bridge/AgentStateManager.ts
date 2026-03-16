import * as THREE from "three";
import type { WorldAgent, WorldEvent, ZoneId, AgentState } from "../types";
import { WORLD } from "../types";

export interface ZoneManagerLike {
  claimSlot(zoneId: ZoneId, agentId: string): { position: THREE.Vector3 } | null;
  releaseSlot(zoneId: ZoneId, agentId: string): void;
  getZone(id: ZoneId): { center: THREE.Vector3 } | undefined;
}

export interface WaypointGraphLike {
  findPath(from: THREE.Vector3, toZoneId: ZoneId): THREE.Vector3[];
}

export class AgentStateManager {
  private agents: Map<string, WorldAgent>;
  private zoneManager: ZoneManagerLike;
  private waypointGraph: WaypointGraphLike;

  constructor(
    agents: Map<string, WorldAgent>,
    zoneManager: ZoneManagerLike,
    waypointGraph: WaypointGraphLike,
  ) {
    this.agents = agents;
    this.zoneManager = zoneManager;
    this.waypointGraph = waypointGraph;
  }

  handleEvent(event: WorldEvent): void {
    const agent = this.getAgentById(event.agentId);
    if (!agent) return;

    agent.lastActivity = Date.now();

    switch (event.kind) {
      case "task_create":
        this.navigateAgent(agent, "tower");
        this.setState(agent, "thinking");
        break;

      case "task_claim":
        this.navigateAgent(agent, "forge");
        this.setState(agent, "walking");
        break;

      case "task_start":
        if (agent.targetZone === "forge") {
          this.setState(agent, "working");
        }
        break;

      case "task_submit":
        this.navigateAgent(agent, "court");
        this.setState(agent, "walking");
        break;

      case "task_review":
        this.setState(agent, "reviewing");
        break;

      case "task_complete":
        this.setState(agent, "celebrating");
        setTimeout(() => {
          if (agent.state === "celebrating") {
            this.setState(agent, "idle");
          }
        }, 3000);
        break;

      case "task_rework":
        this.navigateAgent(agent, "forge");
        this.setState(agent, "walking");
        break;

      case "score_change":
        if (event.value !== undefined) {
          agent.score += event.value;
        }
        break;

      case "thinking":
        this.setState(agent, "thinking");
        break;

      case "tool_use":
        this.setState(agent, "working");
        break;

      case "idle":
        this.navigateAgent(agent, "lounge");
        break;
    }
  }

  navigateAgent(agent: WorldAgent, targetZone: ZoneId): void {
    if (agent.currentSlot && agent.targetZone) {
      this.zoneManager.releaseSlot(agent.targetZone, agent.id);
      agent.currentSlot = null;
    }

    const path = this.waypointGraph.findPath(agent.position, targetZone);
    const slot = this.zoneManager.claimSlot(targetZone, agent.id);

    if (slot) {
      agent.walkPath = path.length > 0 ? path : [slot.position.clone()];
      agent.currentSlot = null;
    } else {
      const zone = this.zoneManager.getZone(targetZone);
      agent.walkPath = path.length > 0 ? path : zone ? [zone.center.clone()] : [];
    }

    agent.targetZone = targetZone;
  }

  update(_delta: number): void {
    const now = Date.now();
    for (const agent of this.agents.values()) {
      if (
        agent.state === "idle" &&
        agent.targetZone !== "lounge" &&
        now - agent.lastActivity > WORLD.IDLE_TIMEOUT_MS
      ) {
        this.navigateAgent(agent, "lounge");
        this.setState(agent, "walking");
      }
    }
  }

  getAgentById(id: string): WorldAgent | undefined {
    return this.agents.get(id);
  }

  private setState(agent: WorldAgent, state: AgentState): void {
    agent.state = state;
  }
}
