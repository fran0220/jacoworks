import * as THREE from "three";
import type { AgentSummary } from "../../lib/feed";
import type { WorldAgent } from "../../observatory/types";
import type { SceneRefs } from "./types";

let avatarRuntimePromise: Promise<{
  AvatarNavigator: typeof import("../../observatory/avatar/AvatarNavigator").AvatarNavigator;
  AvatarAnimator: typeof import("../../observatory/avatar/AvatarAnimator").AvatarAnimator;
}> | null = null;

function loadAvatarRuntime() {
  if (!avatarRuntimePromise) {
    avatarRuntimePromise = Promise.all([
      import("../../observatory/avatar/AvatarNavigator"),
      import("../../observatory/avatar/AvatarAnimator"),
    ]).then(([navigatorModule, animatorModule]) => ({
      AvatarNavigator: navigatorModule.AvatarNavigator,
      AvatarAnimator: animatorModule.AvatarAnimator,
    }));
  }
  return avatarRuntimePromise;
}

export async function createObservatoryScene(
  container: HTMLDivElement,
): Promise<SceneRefs> {
  const [
    { ObservatoryScene },
    { ZoneManager },
    { WaypointGraph },
    { AvatarPool },
    { AvatarFactory },
    { AvatarNavigator },
    { AvatarAnimator },
    { EventBridge },
    { AgentStateManager },
    { IslandEnvironment },
  ] = await Promise.all([
    import("../../observatory/world/ObservatoryScene"),
    import("../../observatory/world/ZoneManager"),
    import("../../observatory/world/WaypointGraph"),
    import("../../observatory/avatar/AvatarPool"),
    import("../../observatory/avatar/AvatarFactory"),
    import("../../observatory/avatar/AvatarNavigator"),
    import("../../observatory/avatar/AvatarAnimator"),
    import("../../observatory/bridge/EventBridge"),
    import("../../observatory/bridge/AgentStateManager"),
    import("../../observatory/world/IslandEnvironment"),
  ]);

  const scene = new ObservatoryScene();
  const threeScene = scene.getScene();
  const env = new IslandEnvironment(threeScene);
  const zones = new ZoneManager(threeScene);
  const waypointGraph = new WaypointGraph();
  const pool = new AvatarPool();
  const factory = new AvatarFactory(pool, threeScene);
  const worldAgents = new Map<string, WorldAgent>();
  const navigators = new Map<string, InstanceType<typeof AvatarNavigator>>();
  const animators = new Map<string, InstanceType<typeof AvatarAnimator>>();

  const stateManager = new AgentStateManager(worldAgents, zones, waypointGraph);
  const eventBridge = new EventBridge((event) => {
    stateManager.handleEvent(event);
  });

  let elapsed = 0;
  scene.setOnUpdate((delta) => {
    elapsed += delta;
    env.update(elapsed);
    zones.update(elapsed);
    stateManager.update(delta);

    for (const [id, nav] of navigators) {
      const agent = worldAgents.get(id);
      if (!agent) continue;

      if (agent.walkPath.length > 0 && !nav.isMoving()) {
        nav.setDestination(agent.walkPath);
        agent.walkPath = [];
        agent.state = "walking";
      }

      const moving = nav.update(delta);
      if (!moving && agent.state === "walking") {
        agent.state = "idle";
      }
    }

    for (const [id, animator] of animators) {
      const agent = worldAgents.get(id);
      if (!agent) continue;
      animator.setState(agent.state);
      animator.update(delta);
      agent.root.position.copy(agent.position);
    }
  });

  scene.mount(container);

  return {
    scene,
    env,
    zones,
    pool,
    factory,
    waypointGraph,
    stateManager,
    eventBridge,
    worldAgents,
    navigators,
    animators,
  };
}

export async function syncSceneAgents(refs: SceneRefs, agents: AgentSummary[]) {
  const summaries = agents.map((agent) => ({
    id: agent.id,
    name: agent.name,
    role: agent.role,
    total_score: agent.total_score,
    current_sub_task: agent.current_sub_task,
  }));

  const { added, removed } = await refs.factory.syncAgents(
    summaries,
    refs.worldAgents,
  );

  const { AvatarNavigator, AvatarAnimator } = await loadAvatarRuntime();

  for (const agent of added) {
    refs.navigators.set(agent.id, new AvatarNavigator(agent));
    const glb = refs.factory.getGLBAvatar(agent.id);
    const mixer = glb ? glb.mixer : new THREE.AnimationMixer(agent.root);
    refs.animators.set(agent.id, new AvatarAnimator(agent.root, mixer, glb?.clips));
  }

  for (const agent of removed) {
    refs.navigators.delete(agent.id);
    refs.animators.delete(agent.id);
  }
}
