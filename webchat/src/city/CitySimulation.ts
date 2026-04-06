import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CITY_ZONES,
  getCitySlot,
  type CityPoint,
  type CityZoneId,
} from "./CityZone";
import {
  CITY_MOVE_DURATION_MS,
  inferCityFacing,
  interpolateCityPoint,
  type CityAgentState,
  type CityFacing,
} from "./CityAgent";
import { pickSpritePackIdFromSeed } from "../lib/sprite-packs";

// ---------------------------------------------------------------------------
// Citizen types
// ---------------------------------------------------------------------------

type CitizenType =
  | "resident"
  | "merchant"
  | "venue_operator"
  | "robot"
  | "developer"
  | "official"
  | "creator";

interface CitizenTypeInfo {
  typeLabel: string;
  accent: string;
  homeZones: CityZoneId[];
  behaviors: string[];
}

const CITIZEN_TYPES: Record<CitizenType, CitizenTypeInfo> = {
  resident: {
    typeLabel: "市民",
    accent: "#60a5fa",
    homeZones: ["eco_garden", "tongming_lake", "esports_center"],
    behaviors: [
      "在通明湖散步放松",
      "到电竞中心观看比赛",
      "在生态花园晨练",
      "去科创中心参观新展览",
      "到物流港取快递",
    ],
  },
  merchant: {
    typeLabel: "商家",
    accent: "#f59e0b",
    homeZones: ["logistics_port", "esports_center", "eco_garden"],
    behaviors: [
      "在物流港清点进货",
      "前往电竞中心摆摊",
      "到生态花园补充食材",
      "去数据中枢查看销售报表",
    ],
  },
  venue_operator: {
    typeLabel: "场馆经营者",
    accent: "#a855f7",
    homeZones: ["esports_center", "innovation_center", "city_hall"],
    behaviors: [
      "在电竞中心调试设备",
      "到科创中心洽谈合作",
      "前往中枢提交经营报告",
      "巡查场馆安全设施",
    ],
  },
  robot: {
    typeLabel: "机器人",
    accent: "#22d3ee",
    homeZones: ["robotics_park", "logistics_port", "data_hub"],
    behaviors: [
      "在机器人产业园充电维护",
      "前往物流港分拣快递",
      "到数据中枢上传巡检日志",
      "沿城市路网执行安防巡检",
      "在科创中心协助搬运实验器材",
    ],
  },
  developer: {
    typeLabel: "开发者",
    accent: "#34d399",
    homeZones: ["innovation_center", "data_hub", "robotics_park"],
    behaviors: [
      "在科创中心查看项目进展",
      "到数据中枢调试接口",
      "前往机器人产业园联调硬件",
      "在通明湖边写技术文档",
    ],
  },
  official: {
    typeLabel: "政务",
    accent: "#f87171",
    homeZones: ["city_hall", "data_hub"],
    behaviors: [
      "在中枢审批城市规划方案",
      "到数据中枢查看民生指标",
      "前往科创中心调研新项目",
      "巡视生态花园绿化工程",
    ],
  },
  creator: {
    typeLabel: "创作者",
    accent: "#c084fc",
    homeZones: ["tongming_lake", "esports_center", "eco_garden"],
    behaviors: [
      "在通明湖直播城市风光",
      "到电竞中心拍摄赛事花絮",
      "在生态花园创作短视频",
      "前往科创中心采访创业者",
    ],
  },
};

// ---------------------------------------------------------------------------
// Citizen definitions
// ---------------------------------------------------------------------------

interface CityCitizen {
  id: string;
  name: string;
  type: CitizenType;
  typeLabel: string;
  accent: string;
  homeZoneId: CityZoneId;
  description: string;
}

const CITY_CITIZENS: CityCitizen[] = [
  // -- residents (10) --
  { id: "c-res-01", name: "林小雨", type: "resident", typeLabel: "市民", accent: "#60a5fa", homeZoneId: "eco_garden", description: "喜欢在花园晨跑的上班族" },
  { id: "c-res-02", name: "王建国", type: "resident", typeLabel: "市民", accent: "#60a5fa", homeZoneId: "tongming_lake", description: "退休后每天绕湖走三圈" },
  { id: "c-res-03", name: "陈晨", type: "resident", typeLabel: "市民", accent: "#60a5fa", homeZoneId: "esports_center", description: "电竞爱好者，周末常来观赛" },
  { id: "c-res-04", name: "赵敏", type: "resident", typeLabel: "市民", accent: "#60a5fa", homeZoneId: "eco_garden", description: "带孩子在花园玩耍的年轻妈妈" },
  { id: "c-res-05", name: "孙文轩", type: "resident", typeLabel: "市民", accent: "#60a5fa", homeZoneId: "tongming_lake", description: "通明湖畔的业余摄影师" },
  { id: "c-res-06", name: "周子涵", type: "resident", typeLabel: "市民", accent: "#60a5fa", homeZoneId: "esports_center", description: "刚搬来亦庄的新住户" },
  { id: "c-res-07", name: "吴佳琪", type: "resident", typeLabel: "市民", accent: "#60a5fa", homeZoneId: "eco_garden", description: "社区志愿者，热心肠" },
  { id: "c-res-08", name: "郑浩然", type: "resident", typeLabel: "市民", accent: "#60a5fa", homeZoneId: "tongming_lake", description: "每天骑车通勤的程序员" },
  { id: "c-res-09", name: "冯雅婷", type: "resident", typeLabel: "市民", accent: "#60a5fa", homeZoneId: "eco_garden", description: "在花园练太极的阿姨" },
  { id: "c-res-10", name: "黄子豪", type: "resident", typeLabel: "市民", accent: "#60a5fa", homeZoneId: "esports_center", description: "放学后来电竞中心的中学生" },
  // -- merchants (4) --
  { id: "c-mer-01", name: "张师傅烤鸭", type: "merchant", typeLabel: "商家", accent: "#f59e0b", homeZoneId: "logistics_port", description: "物流港旁的老字号烤鸭摊" },
  { id: "c-mer-02", name: "李记便利", type: "merchant", typeLabel: "商家", accent: "#f59e0b", homeZoneId: "esports_center", description: "电竞中心门口的便利店老板" },
  { id: "c-mer-03", name: "陈大姐水果", type: "merchant", typeLabel: "商家", accent: "#f59e0b", homeZoneId: "eco_garden", description: "花园入口的鲜果铺" },
  { id: "c-mer-04", name: "老刘茶馆", type: "merchant", typeLabel: "商家", accent: "#f59e0b", homeZoneId: "tongming_lake", description: "通明湖旁的露天茶座" },
  // -- venue_operators (3) --
  { id: "c-ven-01", name: "张经理", type: "venue_operator", typeLabel: "场馆经营者", accent: "#a855f7", homeZoneId: "esports_center", description: "电竞中心运营负责人" },
  { id: "c-ven-02", name: "刘馆长", type: "venue_operator", typeLabel: "场馆经营者", accent: "#a855f7", homeZoneId: "innovation_center", description: "科创展览馆馆长" },
  { id: "c-ven-03", name: "何主任", type: "venue_operator", typeLabel: "场馆经营者", accent: "#a855f7", homeZoneId: "city_hall", description: "中枢服务大厅主任" },
  // -- robots (4) --
  { id: "c-bot-01", name: "巡检 K7", type: "robot", typeLabel: "机器人", accent: "#22d3ee", homeZoneId: "robotics_park", description: "24 小时安防巡检机器人" },
  { id: "c-bot-02", name: "速递 D3", type: "robot", typeLabel: "机器人", accent: "#22d3ee", homeZoneId: "logistics_port", description: "物流港快递分拣机器人" },
  { id: "c-bot-03", name: "清扫 W1", type: "robot", typeLabel: "机器人", accent: "#22d3ee", homeZoneId: "eco_garden", description: "花园道路清扫机器人" },
  { id: "c-bot-04", name: "导览 G5", type: "robot", typeLabel: "机器人", accent: "#22d3ee", homeZoneId: "data_hub", description: "数据中枢访客导览机器人" },
  // -- developers (3) --
  { id: "c-dev-01", name: "许明远", type: "developer", typeLabel: "开发者", accent: "#34d399", homeZoneId: "innovation_center", description: "AI 视觉算法工程师" },
  { id: "c-dev-02", name: "杨思琪", type: "developer", typeLabel: "开发者", accent: "#34d399", homeZoneId: "data_hub", description: "大数据平台后端开发" },
  { id: "c-dev-03", name: "钱磊", type: "developer", typeLabel: "开发者", accent: "#34d399", homeZoneId: "robotics_park", description: "机器人操作系统开发者" },
  // -- officials (2) --
  { id: "c-off-01", name: "李副区长", type: "official", typeLabel: "政务", accent: "#f87171", homeZoneId: "city_hall", description: "分管科技与产业的副区长" },
  { id: "c-off-02", name: "王科长", type: "official", typeLabel: "政务", accent: "#f87171", homeZoneId: "data_hub", description: "数字化治理科科长" },
  // -- creators (2) --
  { id: "c-cre-01", name: "苏小夏", type: "creator", typeLabel: "创作者", accent: "#c084fc", homeZoneId: "tongming_lake", description: "本地生活博主，粉丝 50 万" },
  { id: "c-cre-02", name: "方逸尘", type: "creator", typeLabel: "创作者", accent: "#c084fc", homeZoneId: "esports_center", description: "电竞赛事解说与短视频创作者" },
];

// ---------------------------------------------------------------------------
// State mapping helpers
// ---------------------------------------------------------------------------

const ARRIVAL_STATES: Record<CitizenType, CityAgentState[]> = {
  resident: ["working", "thinking"],
  merchant: ["working"],
  venue_operator: ["working"],
  robot: ["working", "reviewing"],
  developer: ["thinking", "working"],
  official: ["reviewing", "thinking"],
  creator: ["working", "celebrating"],
};

function pickRandom<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

const ALL_ZONE_IDS = Object.keys(CITY_ZONES) as CityZoneId[];

function pickTargetZone(citizen: CityCitizen): CityZoneId {
  const info = CITIZEN_TYPES[citizen.type];
  // 70% chance to go to a preferred zone, 30% chance any zone
  if (Math.random() < 0.7) {
    return pickRandom(info.homeZones);
  }
  return pickRandom(ALL_ZONE_IDS);
}

function pickBehavior(citizen: CityCitizen): string {
  return pickRandom(CITIZEN_TYPES[citizen.type].behaviors);
}

function pickArrivalState(citizenType: CitizenType): CityAgentState {
  return pickRandom(ARRIVAL_STATES[citizenType]);
}

// ---------------------------------------------------------------------------
// Simulation agent state
// ---------------------------------------------------------------------------

interface SimAgent {
  citizen: CityCitizen;
  zoneId: CityZoneId;
  slotIndex: number;
  state: CityAgentState;
  statusText: string;
  position: CityPoint;
  facing: CityFacing;
  /** Timestamp when current dwell started (ms) */
  dwellUntil: number;
  /** Whether currently animating movement */
  moving: boolean;
  moveFrom: CityPoint | null;
  moveTo: CityPoint | null;
  moveStartedAt: number;
}

// ---------------------------------------------------------------------------
// Output type matching DigitalCityPanel.CityAgentModel (duck typed)
// ---------------------------------------------------------------------------

interface SimulationAgentOutput {
  id: string;
  name: string;
  role: string;
  roleLabel: string;
  state: "idle" | "walking" | "working" | "thinking" | "reviewing" | "celebrating";
  statusText: string;
  detailText?: string | null;
  accent: string;
  lngLat: [number, number];
  facing?: "down" | "up" | "right" | "left";
  spritePackId: string;
}

export interface UseCitySimulationResult {
  agents: SimulationAgentOutput[];
  highlightedAgentId: string | null;
  latestStory: string;
  activeCount: number;
}

// ---------------------------------------------------------------------------
// Zone slot allocation
// ---------------------------------------------------------------------------

function allocateSlot(
  zoneId: CityZoneId,
  occupied: Map<CityZoneId, Set<number>>,
): number {
  const zone = CITY_ZONES[zoneId];
  const used = occupied.get(zoneId) ?? new Set();
  for (let i = 0; i < zone.slots.length; i++) {
    if (!used.has(i)) {
      used.add(i);
      occupied.set(zoneId, used);
      return i;
    }
  }
  // overflow: wrap around
  const idx = used.size % zone.slots.length;
  used.add(idx);
  occupied.set(zoneId, used);
  return idx;
}

function releaseSlot(
  zoneId: CityZoneId,
  slotIndex: number,
  occupied: Map<CityZoneId, Set<number>>,
): void {
  const used = occupied.get(zoneId);
  if (used) used.delete(slotIndex);
}

// ---------------------------------------------------------------------------
// Simulation engine (imperative, runs inside useEffect)
// ---------------------------------------------------------------------------

function initializeAgents(occupied: Map<CityZoneId, Set<number>>): SimAgent[] {
  const now = performance.now();
  return CITY_CITIZENS.map((citizen) => {
    const zoneId = citizen.homeZoneId;
    const slotIndex = allocateSlot(zoneId, occupied);
    const position = getCitySlot(zoneId, slotIndex);
    return {
      citizen,
      zoneId,
      slotIndex,
      state: "idle" as CityAgentState,
      statusText: `在${CITY_ZONES[zoneId].label}休息`,
      position,
      facing: "down" as CityFacing,
      dwellUntil: now + randomInt(2000, 8000),
      moving: false,
      moveFrom: null,
      moveTo: null,
      moveStartedAt: 0,
    };
  });
}

function toOutput(agent: SimAgent): SimulationAgentOutput {
  return {
    id: agent.citizen.id,
    name: agent.citizen.name,
    role: agent.citizen.type,
    roleLabel: agent.citizen.typeLabel,
    state: agent.state,
    statusText: agent.statusText,
    detailText: agent.citizen.description,
    accent: agent.citizen.accent,
    lngLat: [agent.position.lng, agent.position.lat],
    facing: agent.facing,
    spritePackId: pickSpritePackIdFromSeed(agent.citizen.id),
  };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useCitySimulation(): UseCitySimulationResult {
  const [outputs, setOutputs] = useState<SimulationAgentOutput[]>([]);
  const [highlightedAgentId, setHighlightedAgentId] = useState<string | null>(null);
  const [latestStory, setLatestStory] = useState("亦庄数字之城正在苏醒...");
  const [activeCount, setActiveCount] = useState(0);

  const agentsRef = useRef<SimAgent[]>([]);
  const occupiedRef = useRef<Map<CityZoneId, Set<number>>>(new Map());
  const tickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rafRef = useRef<number | null>(null);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  // ----- animation frame -----
  const animate = useCallback(() => {
    if (!mountedRef.current) return;
    const now = performance.now();
    let anyMoving = false;

    for (const agent of agentsRef.current) {
      if (!agent.moving || !agent.moveFrom || !agent.moveTo) continue;
      const elapsed = now - agent.moveStartedAt;
      const rawProgress = Math.min(1, elapsed / CITY_MOVE_DURATION_MS);
      // ease in-out cubic
      const progress =
        rawProgress < 0.5
          ? 4 * rawProgress * rawProgress * rawProgress
          : 1 - Math.pow(-2 * rawProgress + 2, 3) / 2;

      if (rawProgress >= 1) {
        agent.position = { ...agent.moveTo };
        agent.moving = false;
        agent.moveFrom = null;
        agent.moveTo = null;
        // Arrive: set arrival state
        const arrivalState = pickArrivalState(agent.citizen.type);
        agent.state = arrivalState;
        agent.statusText = pickBehavior(agent.citizen);
        agent.dwellUntil = now + randomInt(8000, 15000);
      } else {
        agent.position = interpolateCityPoint(agent.moveFrom, agent.moveTo, progress);
        anyMoving = true;
      }
    }

    setOutputs(agentsRef.current.map(toOutput));

    if (anyMoving) {
      rafRef.current = requestAnimationFrame(animate);
    } else {
      rafRef.current = null;
    }
  }, []);

  const ensureRaf = useCallback(() => {
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(animate);
  }, [animate]);

  // ----- tick: select citizens for behavior change -----
  const scheduleTick = useCallback(() => {
    if (!mountedRef.current) return;

    const tick = () => {
      if (!mountedRef.current) return;
      const now = performance.now();
      const agents = agentsRef.current;

      // Collect eligible (not moving, dwell expired)
      const eligible = agents.filter(
        (a) => !a.moving && now >= a.dwellUntil,
      );

      // Robots are always eligible if they're idle or done
      const robotsReady = agents.filter(
        (a) =>
          a.citizen.type === "robot" &&
          !a.moving &&
          now >= a.dwellUntil - 2000,
      );

      const candidates = [...new Set([...eligible, ...robotsReady])];

      // Pick 2-4 citizens
      const count = Math.min(candidates.length, randomInt(2, 4));
      const shuffled = candidates.sort(() => Math.random() - 0.5);
      const selected = shuffled.slice(0, count);

      let lastStory = "";

      for (const agent of selected) {
        const targetZoneId = pickTargetZone(agent.citizen);
        if (targetZoneId === agent.zoneId && agent.state !== "idle") {
          // Stay in place but switch activity
          agent.state = pickArrivalState(agent.citizen.type);
          agent.statusText = pickBehavior(agent.citizen);
          agent.dwellUntil = now + randomInt(8000, 15000);
          lastStory = `${agent.citizen.name}${agent.statusText}`;
          continue;
        }

        // Release old slot
        releaseSlot(agent.zoneId, agent.slotIndex, occupiedRef.current);

        // Allocate new slot
        const newSlotIndex = allocateSlot(targetZoneId, occupiedRef.current);
        const targetPos = getCitySlot(targetZoneId, newSlotIndex);

        // Start movement
        agent.moveFrom = { ...agent.position };
        agent.moveTo = targetPos;
        agent.moveStartedAt = now;
        agent.moving = true;
        agent.state = "walking";
        agent.statusText = `前往${CITY_ZONES[targetZoneId].label}`;
        agent.facing = inferCityFacing(agent.position, targetPos);
        agent.zoneId = targetZoneId;
        agent.slotIndex = newSlotIndex;

        lastStory = `${agent.citizen.name}正在前往${CITY_ZONES[targetZoneId].label}`;
      }

      if (lastStory) {
        setLatestStory(lastStory);
      }

      // Highlight last selected agent
      if (selected.length > 0) {
        const highlighted = selected[selected.length - 1]!;
        setHighlightedAgentId(highlighted.citizen.id);
        if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
        highlightTimerRef.current = setTimeout(() => {
          if (mountedRef.current) setHighlightedAgentId(null);
        }, 3000);
      }

      // Count active (non-idle)
      setActiveCount(
        agents.filter((a) => a.state !== "idle").length,
      );

      // Also check for agents whose dwell expired and should return home
      for (const agent of agents) {
        if (agent.moving) continue;
        if (now < agent.dwellUntil) continue;
        // If celebrating, transition back to idle at home
        if (agent.state === "celebrating") {
          const homeZone = agent.citizen.homeZoneId;
          if (agent.zoneId !== homeZone) {
            releaseSlot(agent.zoneId, agent.slotIndex, occupiedRef.current);
            const slot = allocateSlot(homeZone, occupiedRef.current);
            const pos = getCitySlot(homeZone, slot);
            agent.moveFrom = { ...agent.position };
            agent.moveTo = pos;
            agent.moveStartedAt = now;
            agent.moving = true;
            agent.state = "walking";
            agent.statusText = `返回${CITY_ZONES[homeZone].label}`;
            agent.facing = inferCityFacing(agent.position, pos);
            agent.zoneId = homeZone;
            agent.slotIndex = slot;
          } else {
            agent.state = "idle";
            agent.statusText = `在${CITY_ZONES[agent.zoneId].label}休息`;
            agent.dwellUntil = now + randomInt(5000, 12000);
          }
        }
      }

      setOutputs(agentsRef.current.map(toOutput));
      ensureRaf();

      // Schedule next tick
      const nextDelay = randomInt(3000, 6000);
      tickTimerRef.current = setTimeout(tick, nextDelay);
    };

    tickTimerRef.current = setTimeout(tick, randomInt(1000, 3000));
  }, [ensureRaf]);

  // ----- lifecycle -----
  useEffect(() => {
    mountedRef.current = true;
    const occupied = new Map<CityZoneId, Set<number>>();
    occupiedRef.current = occupied;
    agentsRef.current = initializeAgents(occupied);
    setOutputs(agentsRef.current.map(toOutput));
    setActiveCount(0);
    setLatestStory("亦庄数字之城正在苏醒...");

    scheduleTick();

    return () => {
      mountedRef.current = false;
      if (tickTimerRef.current) clearTimeout(tickTimerRef.current);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
      tickTimerRef.current = null;
      rafRef.current = null;
      highlightTimerRef.current = null;
    };
  }, [scheduleTick]);

  return useMemo(
    () => ({ agents: outputs, highlightedAgentId, latestStory, activeCount }),
    [outputs, highlightedAgentId, latestStory, activeCount],
  );
}
