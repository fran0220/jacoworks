import { ChevronDown, ChevronRight, GitBranch, Layers3, Lock, Workflow } from "lucide-react";
import { useMemo, useState } from "react";
import type { CrewTask } from "../lib/feed";

type CrewTaskBucket = "pending" | "in-progress" | "done" | "blocked";

function bucketTaskStatus(task: CrewTask): CrewTaskBucket {
  if (task.status === "done") return "done";
  if (
    task.status === "blocked" ||
    task.status === "failed" ||
    task.status === "timeout"
  ) {
    return "blocked";
  }
  if (task.status === "assigned" || task.status === "running" || task.status === "in-progress") {
    return "in-progress";
  }
  return "pending";
}

function getStatusLabel(bucket: CrewTaskBucket): string {
  if (bucket === "pending") return "待排队";
  if (bucket === "in-progress") return "推进中";
  if (bucket === "done") return "已完成";
  return "阻塞";
}

function formatWaveLabel(currentWave: number | null, totalWaves: number): string {
  if (currentWave === null) return `Wave 0/${totalWaves || 0}`;
  return `Wave ${currentWave}/${totalWaves}`;
}

export default function CrewProgressBar({ tasks }: { tasks: CrewTask[] }) {
  const [expanded, setExpanded] = useState(false);

  const summary = useMemo(() => {
    const tasksById = new Map(tasks.map((task) => [task.id, task]));
    const waves = Array.from(
      new Set(tasks.map((task) => task.wave).filter((wave): wave is number => wave !== null)),
    ).sort((a, b) => a - b);
    const fallbackWave = waves[0] ?? null;
    const currentWave =
      waves.find((wave) =>
        tasks.some((task) => task.wave === wave && bucketTaskStatus(task) !== "done"),
      ) ?? fallbackWave;
    const waveTasks = currentWave === null ? tasks : tasks.filter((task) => task.wave === currentWave);
    const doneCount = waveTasks.filter((task) => bucketTaskStatus(task) === "done").length;
    const buckets: Record<CrewTaskBucket, number> = {
      pending: 0,
      "in-progress": 0,
      done: 0,
      blocked: 0,
    };

    for (const task of tasks) {
      buckets[bucketTaskStatus(task)] += 1;
    }

    const graphRows = tasks
      .slice()
      .sort((a, b) => {
        const waveA = a.wave ?? Number.MAX_SAFE_INTEGER;
        const waveB = b.wave ?? Number.MAX_SAFE_INTEGER;
        if (waveA !== waveB) return waveA - waveB;
        return a.name.localeCompare(b.name, "zh-CN");
      })
      .map((task) => ({
        ...task,
        bucket: bucketTaskStatus(task),
        dependencyNames: task.dependencies
          .map((dependencyId) => tasksById.get(dependencyId)?.name ?? dependencyId)
          .filter(Boolean),
      }));

    return {
      buckets,
      currentWave,
      totalWaves: waves.length || 1,
      waveTasks,
      doneCount,
      progress:
        waveTasks.length > 0 ? Math.round((doneCount / waveTasks.length) * 100) : 0,
      graphRows,
    };
  }, [tasks]);

  if (tasks.length === 0) return null;

  return (
    <section className="crew-progress-card">
      <div className="crew-progress-head">
        <span className="crew-progress-kicker">
          <Layers3 size={14} />
          Crew 波次推进
        </span>
        <strong>{formatWaveLabel(summary.currentWave, summary.totalWaves)}</strong>
      </div>

      <div className="crew-progress-copy">
        <span>
          <Workflow size={14} />
          {summary.doneCount}/{summary.waveTasks.length || tasks.length} tasks done
        </span>
        <span>{summary.progress}%</span>
      </div>

      <div className="crew-progress-track" aria-hidden="true">
        <div className="crew-progress-fill" style={{ width: `${summary.progress}%` }} />
      </div>

      <div className="crew-progress-stats">
        {([
          "pending",
          "in-progress",
          "done",
          "blocked",
        ] as CrewTaskBucket[]).map((bucket) => (
          <div key={bucket} className={`crew-progress-stat crew-progress-stat--${bucket}`}>
            <span>{getStatusLabel(bucket)}</span>
            <strong>{summary.buckets[bucket]}</strong>
          </div>
        ))}
      </div>

      <button
        className="crew-progress-toggle"
        type="button"
        onClick={() => setExpanded((value) => !value)}
      >
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span>任务依赖图</span>
        <small>{expanded ? "收起" : "展开"}</small>
      </button>

      {expanded && (
        <div className="crew-graph-list">
          {summary.graphRows.map((task) => (
            <article key={task.id} className={`crew-graph-row crew-graph-row--${task.bucket}`}>
              <div className="crew-graph-row-head">
                <span className="crew-graph-wave">W{task.wave ?? "-"}</span>
                <strong>{task.name}</strong>
                <em>{getStatusLabel(task.bucket)}</em>
              </div>
              <div className="crew-graph-row-meta">
                <span>
                  <GitBranch size={12} />
                  {task.dependencyNames.length > 0 ? task.dependencyNames.join(" / ") : "无依赖"}
                </span>
                <span>
                  <Lock size={12} />
                  {task.assignee || "待认领"}
                </span>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
