import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CityZoneId } from "./CityZone";
import { CITY_SIM_WAKEUP_STORY } from "./simulation/data";
import {
  animateAgents,
  initializeAgents,
  randomInt,
  runSimulationTick,
  toSimulationOutput,
} from "./simulation/engine";
import type {
  SimAgent,
  SimulationAgentOutput,
  UseCitySimulationResult,
} from "./simulation/types";

export type { UseCitySimulationResult } from "./simulation/types";

export function useCitySimulation(): UseCitySimulationResult {
  const [outputs, setOutputs] = useState<SimulationAgentOutput[]>([]);
  const [highlightedAgentId, setHighlightedAgentId] = useState<string | null>(null);
  const [latestStory, setLatestStory] = useState(CITY_SIM_WAKEUP_STORY);
  const [activeCount, setActiveCount] = useState(0);

  const agentsRef = useRef<SimAgent[]>([]);
  const occupiedRef = useRef<Map<CityZoneId, Set<number>>>(new Map());
  const tickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rafRef = useRef<number | null>(null);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const animate = useCallback(() => {
    if (!mountedRef.current) return;

    const anyMoving = animateAgents(agentsRef.current, performance.now());
    setOutputs(agentsRef.current.map(toSimulationOutput));

    if (anyMoving) {
      rafRef.current = requestAnimationFrame(animate);
      return;
    }
    rafRef.current = null;
  }, []);

  const ensureRaf = useCallback(() => {
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(animate);
  }, [animate]);

  const scheduleTick = useCallback(() => {
    if (!mountedRef.current) return;

    const tick = () => {
      if (!mountedRef.current) return;

      const now = performance.now();
      const tickResult = runSimulationTick(
        agentsRef.current,
        occupiedRef.current,
        now,
      );

      if (tickResult.lastStory) {
        setLatestStory(tickResult.lastStory);
      }

      if (tickResult.highlightedAgentId) {
        setHighlightedAgentId(tickResult.highlightedAgentId);
        if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
        highlightTimerRef.current = setTimeout(() => {
          if (mountedRef.current) setHighlightedAgentId(null);
        }, 3000);
      }

      setActiveCount(tickResult.activeCount);
      setOutputs(agentsRef.current.map(toSimulationOutput));
      ensureRaf();

      tickTimerRef.current = setTimeout(tick, randomInt(3000, 6000));
    };

    tickTimerRef.current = setTimeout(tick, randomInt(1000, 3000));
  }, [ensureRaf]);

  useEffect(() => {
    mountedRef.current = true;
    const occupied = new Map<CityZoneId, Set<number>>();
    occupiedRef.current = occupied;
    agentsRef.current = initializeAgents(occupied);

    setOutputs(agentsRef.current.map(toSimulationOutput));
    setActiveCount(0);
    setLatestStory(CITY_SIM_WAKEUP_STORY);
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
