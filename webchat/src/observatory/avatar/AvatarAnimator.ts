import * as THREE from "three";
import type { VRM } from "@pixiv/three-vrm";
import type { AgentState } from "../types";

interface ProceduralState {
  breathPhase: number;
  swayPhase: number;
  walkPhase: number;
  armPhase: number;
  bouncePhase: number;
}

const BLINK_MIN_INTERVAL = 2;
const BLINK_MAX_INTERVAL = 6;
const BLINK_DURATION = 0.15;

export class AvatarAnimator {
  private vrm: VRM | null;
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

  // Blink
  private blinkTimer = 0;
  private nextBlinkAt = this.randomBlinkInterval();
  private blinkValue = 0;
  private isBlinking = false;
  private blinkElapsed = 0;

  // Base transforms
  private baseScaleY = 1;
  private basePositionY = 0;

  constructor(vrm: VRM | null, mesh: THREE.Object3D) {
    this.vrm = vrm;
    this.root = vrm ? vrm.scene : mesh;
    this.mixer = new THREE.AnimationMixer(this.root);
    this.baseScaleY = this.root.scale.y;
    this.basePositionY = this.root.position.y;
  }

  setState(state: AgentState): void {
    if (state === this.state) return;
    this.targetState = state;
    this.transitionProgress = 0;
    this.mapStateExpression(state);
  }

  update(delta: number): void {
    // Transition blending
    if (this.targetState && this.transitionProgress < 1) {
      this.transitionProgress = Math.min(1, this.transitionProgress + delta * this.transitionSpeed);
      if (this.transitionProgress >= 1) {
        this.state = this.targetState;
        this.targetState = null;
      }
    }

    this.mixer.update(delta);
    this.updateProcedural(delta);
    this.updateBlink(delta);

    if (this.vrm) this.vrm.update(delta);
  }

  setExpression(name: string, value: number): void {
    if (!this.vrm?.expressionManager) return;
    this.vrm.expressionManager.setValue(name, value);
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

    const breathScale = this.baseScaleY * (1 + Math.sin(p.breathPhase) * 0.002);
    const swayX = Math.sin(p.swayPhase) * 0.01;

    this.root.scale.y = breathScale;
    this.root.rotation.z = swayX;
  }

  private animateWalk(delta: number, p: ProceduralState): void {
    p.walkPhase += delta * 6;
    p.armPhase += delta * 6;

    const bob = Math.abs(Math.sin(p.walkPhase)) * 0.05;
    const lean = 0.03;

    this.root.position.y = this.basePositionY + bob;
    this.root.rotation.x = lean;

    // Arm swing via slight Z rotation oscillation
    this.root.rotation.z = Math.sin(p.armPhase) * 0.04;
  }

  private animateWork(delta: number, p: ProceduralState): void {
    p.walkPhase += delta * 8;
    p.breathPhase += delta * 2;

    const bob = Math.abs(Math.sin(p.walkPhase)) * 0.03;
    const lean = 0.05;

    this.root.position.y = this.basePositionY + bob;
    this.root.rotation.x = lean;
    this.root.scale.y = this.baseScaleY * (1 + Math.sin(p.breathPhase) * 0.002);
  }

  private animateThink(delta: number, p: ProceduralState): void {
    p.swayPhase += delta * 0.4;
    p.breathPhase += delta * 1.2;

    // Head tilt effect via slight Z rotation
    const tilt = Math.sin(p.swayPhase) * 0.06;
    const breathScale = this.baseScaleY * (1 + Math.sin(p.breathPhase) * 0.001);

    this.root.rotation.z = tilt;
    this.root.scale.y = breathScale;
  }

  private animateCelebrate(delta: number, p: ProceduralState): void {
    p.bouncePhase += delta * 10;

    const bounce = Math.abs(Math.sin(p.bouncePhase)) * 0.15;
    this.root.position.y = this.basePositionY + bounce;
    this.root.rotation.z = Math.sin(p.bouncePhase * 0.5) * 0.05;

    if (this.vrm) {
      this.setExpression("happy", 0.8);
    }
  }

  private updateBlink(delta: number): void {
    if (!this.vrm?.expressionManager) return;

    if (this.isBlinking) {
      this.blinkElapsed += delta;
      if (this.blinkElapsed < BLINK_DURATION * 0.5) {
        this.blinkValue = this.blinkElapsed / (BLINK_DURATION * 0.5);
      } else if (this.blinkElapsed < BLINK_DURATION) {
        this.blinkValue = 1 - (this.blinkElapsed - BLINK_DURATION * 0.5) / (BLINK_DURATION * 0.5);
      } else {
        this.blinkValue = 0;
        this.isBlinking = false;
        this.blinkElapsed = 0;
        this.nextBlinkAt = this.randomBlinkInterval();
        this.blinkTimer = 0;
      }
      this.vrm.expressionManager.setValue("blink", this.blinkValue);
    } else {
      this.blinkTimer += delta;
      if (this.blinkTimer >= this.nextBlinkAt) {
        this.isBlinking = true;
        this.blinkElapsed = 0;
      }
    }
  }

  private mapStateExpression(state: AgentState): void {
    if (!this.vrm?.expressionManager) return;

    // Reset
    this.vrm.expressionManager.setValue("happy", 0);
    this.vrm.expressionManager.setValue("neutral", 0);
    this.vrm.expressionManager.setValue("relaxed", 0);

    switch (state) {
      case "thinking":
        this.vrm.expressionManager.setValue("neutral", 0.6);
        break;
      case "working":
      case "reviewing":
        this.vrm.expressionManager.setValue("neutral", 0.4);
        break;
      case "celebrating":
        this.vrm.expressionManager.setValue("happy", 0.8);
        break;
      case "idle":
      case "spawning":
        this.vrm.expressionManager.setValue("relaxed", 0.3);
        break;
    }
  }

  private randomBlinkInterval(): number {
    return BLINK_MIN_INTERVAL + Math.random() * (BLINK_MAX_INTERVAL - BLINK_MIN_INTERVAL);
  }
}
