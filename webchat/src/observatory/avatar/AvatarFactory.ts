import * as THREE from "three";
import type { WorldAgent } from "../types";
import { getRoleConfig, WORLD } from "../types";
import { AvatarPool } from "./AvatarPool";

export interface AgentSummary {
  id: string;
  name: string;
  role: string;
  total_score: number;
  current_sub_task: { name: string } | null;
}

export class AvatarFactory {
  private pool: AvatarPool;
  private scene: THREE.Scene;

  constructor(pool: AvatarPool, scene: THREE.Scene) {
    this.pool = pool;
    this.scene = scene;
  }

  async createAgent(summary: AgentSummary): Promise<WorldAgent> {
    const config = getRoleConfig(summary.role);

    // Try VRM first, fallback to placeholder
    let vrm = await this.pool.createInstance(summary.id, summary.role);
    let root: THREE.Object3D;

    if (vrm) {
      root = vrm.scene;
    } else {
      const fallback = this.pool.getFallbackMesh(summary.role);
      root = fallback;
      vrm = null;
    }

    // Spawn at edge of island, random angle
    const angle = Math.random() * Math.PI * 2;
    const spawnPos = new THREE.Vector3(
      Math.cos(angle) * WORLD.SPAWN_EDGE_RADIUS,
      0,
      Math.sin(angle) * WORLD.SPAWN_EDGE_RADIUS,
    );

    root.position.copy(spawnPos);
    this.scene.add(root);

    const agent: WorldAgent = {
      id: summary.id,
      name: summary.name,
      role: summary.role,
      config,
      vrm,
      root,
      state: "spawning",
      position: spawnPos,
      targetZone: null,
      walkPath: [],
      walkSpeed: WORLD.WALK_SPEED,
      currentSlot: null,
      score: summary.total_score,
      currentTask: summary.current_sub_task?.name ?? null,
      lastActivity: Date.now(),
    };

    return agent;
  }

  removeAgent(agent: WorldAgent): void {
    this.scene.remove(agent.root);
    this.pool.releaseInstance(agent.id);
  }

  async syncAgents(
    summaries: AgentSummary[],
    existing: Map<string, WorldAgent>,
  ): Promise<{ added: WorldAgent[]; removed: WorldAgent[] }> {
    const incomingIds = new Set(summaries.map((s) => s.id));
    const added: WorldAgent[] = [];
    const removed: WorldAgent[] = [];

    // Remove agents no longer in summaries
    for (const [id, agent] of existing) {
      if (!incomingIds.has(id)) {
        this.removeAgent(agent);
        existing.delete(id);
        removed.push(agent);
      }
    }

    // Add new agents
    for (const summary of summaries) {
      if (!existing.has(summary.id)) {
        const agent = await this.createAgent(summary);
        existing.set(agent.id, agent);
        added.push(agent);
      } else {
        // Update existing agent's dynamic fields
        const agent = existing.get(summary.id)!;
        agent.score = summary.total_score;
        agent.currentTask = summary.current_sub_task?.name ?? null;
        agent.lastActivity = Date.now();
      }
    }

    return { added, removed };
  }
}
