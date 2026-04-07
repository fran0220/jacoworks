import * as THREE from "three";
import type { AgentState } from "../types";

interface ProceduralState {
  breathPhase: number;
  swayPhase: number;
  walkPhase: number;
  armPhase: number;
  bouncePhase: number;
}

export class AvatarAnimator {
  private static readonly STATE_TO_CLIP: Record<AgentState, string> = {
    idle: "idle",
    spawning: "idle",
    walking: "walk",
    working: "idle",
    thinking: "idle",
    reviewing: "walk",
    celebrating: "clap",
    patrolling: "walk",
    despawning: "idle",
  };

  private root: THREE.Object3D;
  private mixer: THREE.AnimationMixer;
  private state: AgentState = "idle";
  private targetState: AgentState | null = null;
  private transitionProgress = 1;
  private transitionSpeed = 3;

  private proc: ProceduralState = {
    breathPhase: Math.random() * Math.PI * 2,
    swayPhase: Math.random() * Math.PI * 2,
    walkPhase: 0,
    armPhase: 0,
    bouncePhase: 0,
  };

  private baseScaleY = 1;
  private basePositionY = 0;

  // GLB clip-based animation
  private clips: Record<string, THREE.AnimationClip> | null = null;
  private currentAction: THREE.AnimationAction | null = null;
  private useClipAnimation = false;

  constructor(mesh: THREE.Object3D, mixer: THREE.AnimationMixer, clips?: Record<string, THREE.AnimationClip>) {
    this.root = mesh;
    this.mixer = mixer;
    this.baseScaleY = this.root.scale.y;
    this.basePositionY = this.root.position.y;

    if (clips && Object.keys(clips).length > 0) {
      this.clips = clips;
      this.useClipAnimation = true;
      const idleClip = clips["idle"];
      if (idleClip) {
        this.currentAction = this.mixer.clipAction(idleClip);
        this.currentAction.play();
      }
    }
  }

  setState(state: AgentState): void {
    if (state === this.state) return;
    this.targetState = state;
    this.transitionProgress = 0;

    if (this.useClipAnimation && this.clips) {
      const clipName = AvatarAnimator.STATE_TO_CLIP[state] ?? "idle";
      const clip = this.clips[clipName];
      if (clip) {
        const newAction = this.mixer.clipAction(clip);
        newAction.reset();
        if (this.currentAction && this.currentAction !== newAction) {
          this.currentAction.crossFadeTo(newAction, 0.3, true);
        }
        newAction.play();
        this.currentAction = newAction;
      }
    }
  }

  update(delta: number): void {
    if (this.targetState && this.transitionProgress < 1) {
      this.transitionProgress = Math.min(1, this.transitionProgress + delta * this.transitionSpeed);
      if (this.transitionProgress >= 1) {
        this.state = this.targetState;
        this.targetState = null;
      }
    }

    this.mixer.update(delta);
    if (!this.useClipAnimation) {
      this.updateProcedural(delta);
    }
  }

  private updateProcedural(delta: number): void {
    const p = this.proc;
    const effectiveState = this.targetState ?? this.state;

    switch (effectiveState) {
      case "idle":
      case "spawning":
        this.animateIdle(delta, p);
        break;
      case "walking":
      case "patrolling":
        this.animateWalk(delta, p);
        break;
      case "working":
      case "reviewing":
        this.animateWork(delta, p);
        break;
      case "thinking":
        this.animateThink(delta, p);
        break;
      case "celebrating":
        this.animateCelebrate(delta, p);
        break;
      case "despawning":
        this.animateIdle(delta, p);
        break;
    }
  }

  private animateIdle(delta: number, p: ProceduralState): void {
    p.breathPhase += delta * 1.5;
    p.swayPhase += delta * 0.6;
    this.root.scale.y = this.baseScaleY * (1 + Math.sin(p.breathPhase) * 0.002);
    this.root.rotation.z = Math.sin(p.swayPhase) * 0.01;
  }

  private animateWalk(delta: number, p: ProceduralState): void {
    p.walkPhase += delta * 6;
    p.armPhase += delta * 6;
    this.root.position.y = this.basePositionY + Math.abs(Math.sin(p.walkPhase)) * 0.05;
    this.root.rotation.x = 0.03;
    this.root.rotation.z = Math.sin(p.armPhase) * 0.04;
  }

  private animateWork(delta: number, p: ProceduralState): void {
    p.walkPhase += delta * 8;
    p.breathPhase += delta * 2;
    this.root.position.y = this.basePositionY + Math.abs(Math.sin(p.walkPhase)) * 0.03;
    this.root.rotation.x = 0.05;
    this.root.scale.y = this.baseScaleY * (1 + Math.sin(p.breathPhase) * 0.002);
  }

  private animateThink(delta: number, p: ProceduralState): void {
    p.swayPhase += delta * 0.4;
    p.breathPhase += delta * 1.2;
    this.root.rotation.z = Math.sin(p.swayPhase) * 0.06;
    this.root.scale.y = this.baseScaleY * (1 + Math.sin(p.breathPhase) * 0.001);
  }

  private animateCelebrate(delta: number, p: ProceduralState): void {
    p.bouncePhase += delta * 10;
    this.root.position.y = this.basePositionY + Math.abs(Math.sin(p.bouncePhase)) * 0.15;
    this.root.rotation.z = Math.sin(p.bouncePhase * 0.5) * 0.05;
  }
}
