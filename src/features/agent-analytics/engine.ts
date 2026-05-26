import type { ActivityEvent } from "../activity-bus/types";
import type { ActivityBus } from "../activity-bus/activity-bus";
import type {
  AgentStats,
  AnalyticsSnapshot,
  HeatmapCell,
  TaskDurationSample,
} from "./types";

const DEFAULT_MAX_SAMPLES = 500;
const TOKENS_PER_TOOL_CALL = 1000;
const COST_PER_TOKEN_USD = 0.000002;
const MINUTE_MS = 60_000;

export class AnalyticsEngine {
  private agentStats = new Map<string, AgentStats>();
  private durationSamples: TaskDurationSample[] = [];
  private readonly maxSamples: number;
  private startTime: number;
  private heatmapBuckets = new Map<string, Map<number, number>>();
  private unsub: (() => void) | null = null;

  constructor(
    private activityBus: ActivityBus,
    options?: { maxSamples?: number },
  ) {
    this.maxSamples = options?.maxSamples ?? DEFAULT_MAX_SAMPLES;
    this.startTime = Date.now();
  }

  start(): void {
    if (this.unsub) return;
    this.startTime = Date.now();
    this.unsub = this.activityBus.onAny((event: ActivityEvent) => {
      this.handleEvent(event);
    });
  }

  stop(): void {
    if (this.unsub) {
      this.unsub();
      this.unsub = null;
    }
  }

  getSnapshot(): AnalyticsSnapshot {
    return this.buildSnapshot();
  }

  private handleEvent(event: ActivityEvent): void {
    switch (event.kind) {
      case "task:created": {
        const { agent } = event.data;
        this.ensureAgentStats(agent);
        const stats = this.agentStats.get(agent)!;
        stats.totalTasks++;
        stats.lastActivity = Math.max(stats.lastActivity, event.timestamp);
        break;
      }
      case "task:completed": {
        const agent = this.resolveAgentForTask(event.data.taskId);
        if (!agent) break;
        const stats = this.ensureAgentStats(agent);
        stats.completedTasks++;
        stats.totalDurationMs += event.data.duration;
        stats.lastActivity = Math.max(stats.lastActivity, event.timestamp);

        this.addDurationSample({
          taskId: event.data.taskId,
          agent,
          durationMs: event.data.duration,
          timestamp: event.timestamp,
          kind: "task:completed",
        });
        break;
      }
      case "task:error": {
        const agent = this.resolveAgentForTask(event.data.taskId);
        if (!agent) break;
        const stats = this.ensureAgentStats(agent);
        stats.failedTasks++;
        stats.totalDurationMs += event.data.duration;
        stats.lastActivity = Math.max(stats.lastActivity, event.timestamp);

        this.addDurationSample({
          taskId: event.data.taskId,
          agent,
          durationMs: event.data.duration,
          timestamp: event.timestamp,
          kind: "task:error",
        });
        break;
      }
      case "agent:activity": {
        const { agent } = event.data;
        const stats = this.ensureAgentStats(agent);
        stats.toolCalls++;
        stats.activeTimeMs += 100; // rough estimate: 100ms per activity tick
        stats.lastActivity = Math.max(stats.lastActivity, event.timestamp);
        break;
      }
      case "agent:completed": {
        const { agent, duration } = event.data;
        const stats = this.ensureAgentStats(agent);
        stats.activeTimeMs += duration;
        stats.lastActivity = Math.max(stats.lastActivity, event.timestamp);
        break;
      }
      case "agent:spawned": {
        const { agent } = event.data;
        this.ensureAgentStats(agent);
        break;
      }
    }

    // Update heatmap for all events
    this.updateHeatmap(event);
  }

  private resolveAgentForTask(taskId: string): string | undefined {
    // Find the task:created event for this taskId to get the agent name
    for (const [, stats] of this.agentStats) {
      if (stats.totalTasks > 0 || stats.completedTasks > 0 || stats.failedTasks > 0) {
        // Try matching via recent events from buffer
        const events = this.activityBus.getRecentEvents("task:created", 100);
        const match = events.find(
          (e) => e.kind === "task:created" && e.data.taskId === taskId,
        );
        if (match && match.kind === "task:created") {
          return match.data.agent;
        }
      }
    }
    // Fallback: search the whole buffer
    const allCreated = this.activityBus.getRecentEvents("task:created", 100);
    const match = allCreated.find(
      (e) => e.kind === "task:created" && e.data.taskId === taskId,
    );
    return match?.kind === "task:created" ? match.data.agent : undefined;
  }

  private ensureAgentStats(agent: string): AgentStats {
    let stats = this.agentStats.get(agent);
    if (!stats) {
      stats = {
        agentName: agent,
        totalTasks: 0,
        completedTasks: 0,
        failedTasks: 0,
        totalDurationMs: 0,
        activeTimeMs: 0,
        lastActivity: 0,
        toolCalls: 0,
      };
      this.agentStats.set(agent, stats);
    }
    return stats;
  }

  private addDurationSample(sample: TaskDurationSample): void {
    this.durationSamples.push(sample);
    if (this.durationSamples.length > this.maxSamples) {
      this.durationSamples.shift();
    }
  }

  private updateHeatmap(event: ActivityEvent): void {
    if (event.kind !== "agent:activity" && event.kind !== "agent:spawned" && event.kind !== "agent:completed") return;

    const agent =
      event.kind === "agent:activity"
        ? event.data.agent
        : event.kind === "agent:spawned"
          ? event.data.agent
          : event.data.agent;

    const timeBucket = Math.floor(event.timestamp / MINUTE_MS) * MINUTE_MS;

    let agentBuckets = this.heatmapBuckets.get(agent);
    if (!agentBuckets) {
      agentBuckets = new Map();
      this.heatmapBuckets.set(agent, agentBuckets);
    }

    agentBuckets.set(timeBucket, (agentBuckets.get(timeBucket) ?? 0) + 1);
  }

  private buildSnapshot(): AnalyticsSnapshot {
    const agentStats = [...this.agentStats.values()];
    const uptimeMs = Date.now() - this.startTime;

    return {
      agentStats,
      recentDurations: [...this.durationSamples],
      heatmap: this.computeHeatmap(),
      successRate: this.computeSuccessRate(),
      costEstimate: this.computeCostEstimate(),
      summary: this.computeSummary(agentStats, uptimeMs),
    };
  }

  private computeHeatmap(): HeatmapCell[] {
    const cells: HeatmapCell[] = [];

    for (const [agentName, buckets] of this.heatmapBuckets) {
      let maxCount = 0;
      const entries: { timeBucket: number; count: number }[] = [];

      for (const [timeBucket, count] of buckets) {
        if (count > maxCount) maxCount = count;
        entries.push({ timeBucket, count });
      }

      for (const { timeBucket, count } of entries) {
        cells.push({
          agentName,
          timeBucket,
          intensity: maxCount > 0 ? count / maxCount : 0,
          eventCount: count,
        });
      }
    }

    return cells;
  }

  private computeSuccessRate(): { agent: string; rate: number; total: number; failed: number }[] {
    const results: { agent: string; rate: number; total: number; failed: number }[] = [];

    for (const stats of this.agentStats.values()) {
      const completed = stats.completedTasks;
      const failed = stats.failedTasks;
      const total = completed + failed;

      results.push({
        agent: stats.agentName,
        rate: total > 0 ? completed / total : 1,
        total,
        failed,
      });
    }

    return results;
  }

  private computeCostEstimate(): { agent: string; estimatedTokens: number; estimatedCostUsd: number }[] {
    const estimates: { agent: string; estimatedTokens: number; estimatedCostUsd: number }[] = [];

    for (const stats of this.agentStats.values()) {
      const estimatedTokens = stats.toolCalls * TOKENS_PER_TOOL_CALL;
      const estimatedCostUsd = estimatedTokens * COST_PER_TOKEN_USD;

      estimates.push({
        agent: stats.agentName,
        estimatedTokens,
        estimatedCostUsd,
      });
    }

    return estimates;
  }

  private computeSummary(
    agentStats: AgentStats[],
    uptimeMs: number,
  ): AnalyticsSnapshot["summary"] {
    let totalTasks = 0;
    let totalCompleted = 0;
    let totalFailed = 0;
    let totalDurationMs = 0;

    for (const stats of agentStats) {
      totalTasks += stats.totalTasks;
      totalCompleted += stats.completedTasks;
      totalFailed += stats.failedTasks;
      totalDurationMs += stats.totalDurationMs;
    }

    return {
      totalTasks,
      totalCompleted,
      totalFailed,
      avgDurationMs: totalCompleted + totalFailed > 0
        ? Math.round(totalDurationMs / (totalCompleted + totalFailed))
        : 0,
      uptimeMs,
    };
  }
}
