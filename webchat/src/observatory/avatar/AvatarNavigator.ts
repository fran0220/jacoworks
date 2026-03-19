import * as THREE from "three";
import type { WorldAgent } from "../types";
import { WORLD } from "../types";

const WAYPOINT_THRESHOLD = 0.15;
const ROTATION_LERP_SPEED = 8;

export class AvatarNavigator {
  private agent: WorldAgent;
  private path: THREE.Vector3[] = [];
  private pathIndex = 0;
  private moving = false;
  private targetQuaternion = new THREE.Quaternion();

  constructor(agent: WorldAgent) {
    this.agent = agent;
  }

  setDestination(path: THREE.Vector3[]): void {
    if (path.length === 0) return;
    this.path = path;
    this.pathIndex = 0;
    this.moving = true;
  }

  update(delta: number): boolean {
    if (!this.moving || this.pathIndex >= this.path.length) {
      this.moving = false;
      return false;
    }

    const target = this.path[this.pathIndex];
    const pos = this.agent.position;
    const speed = this.agent.walkSpeed || WORLD.WALK_SPEED;

    // Direction to current waypoint
    const dx = target.x - pos.x;
    const dz = target.z - pos.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    if (dist < WAYPOINT_THRESHOLD) {
      this.pathIndex++;
      if (this.pathIndex >= this.path.length) {
        this.moving = false;
        return false;
      }
      return true;
    }

    // Move toward waypoint
    const step = Math.min(speed * delta, dist);
    const nx = dx / dist;
    const nz = dz / dist;

    pos.x += nx * step;
    pos.z += nz * step;

    // Smooth rotation to face movement direction
    const root = this.agent.root;
    if (root) {
      const angle = Math.atan2(nx, nz);
      this.targetQuaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle);
      root.quaternion.slerp(this.targetQuaternion, Math.min(1, ROTATION_LERP_SPEED * delta));
      root.position.copy(pos);
    }

    return true;
  }

  isMoving(): boolean {
    return this.moving;
  }

  stop(): void {
    this.path = [];
    this.pathIndex = 0;
    this.moving = false;
  }
}
