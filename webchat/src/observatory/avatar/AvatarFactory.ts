import * as THREE from "three";
import type { WorldAgent } from "../types";
import { getRoleConfig, WORLD } from "../types";
import { AvatarPool } from "./AvatarPool";
import type { GLBAvatar } from "./AvatarPool";
import { fetchAvatar } from "../../lib/avatars";

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
  private glbAvatars = new Map<string, GLBAvatar>();

  constructor(pool: AvatarPool, scene: THREE.Scene) {
    this.pool = pool;
    this.scene = scene;
  }

  getGLBAvatar(agentId: string): GLBAvatar | undefined {
    return this.glbAvatars.get(agentId);
  }

  async createAgent(summary: AgentSummary): Promise<WorldAgent> {
    const config = getRoleConfig(summary.role);
    let root: THREE.Object3D;

    // Try GLB avatar from API, fallback to capsule mesh
    try {
      const profile = await fetchAvatar(summary.role);
      if (profile && profile.model_url) {
        const glbAvatar = await this.pool.loadGLBAvatar(summary.id, profile.model_url, profile.anim_urls);
        this.glbAvatars.set(summary.id, glbAvatar);
        root = glbAvatar.scene;
      } else {
        root = this.pool.getFallbackMesh(summary.role);
      }
    } catch (err) {
      console.warn("[AvatarFactory] GLB load failed, using fallback:", err);
      root = this.pool.getFallbackMesh(summary.role);
    }

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
    this.glbAvatars.delete(agent.id);
  }

  async syncAgents(
    summaries: AgentSummary[],
    existing: Map<string, WorldAgent>,
  ): Promise<{ added: WorldAgent[]; removed: WorldAgent[] }> {
    const incomingIds = new Set(summaries.map((s) => s.id));
    const added: WorldAgent[] = [];
    const removed: WorldAgent[] = [];

    for (const [id, agent] of existing) {
      if (!incomingIds.has(id)) {
        this.removeAgent(agent);
        existing.delete(id);
        removed.push(agent);
      }
    }

    for (const summary of summaries) {
      if (!existing.has(summary.id)) {
        const agent = await this.createAgent(summary);
        existing.set(agent.id, agent);
        added.push(agent);
      } else {
        const agent = existing.get(summary.id)!;
        agent.score = summary.total_score;
        agent.currentTask = summary.current_sub_task?.name ?? null;
        agent.lastActivity = Date.now();
      }
    }

    return { added, removed };
  }
}
