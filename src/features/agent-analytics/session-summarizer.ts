import type { AnalyticsSnapshot } from "./types";

export interface SessionSummary {
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  successRate: number;
  avgDuration: string;
  agentsUsed: number;
  agentNames: string[];
  mostUsedAgent: string | null;
  totalEstimatedCost: number;
  uptime: string;
  topPerformers: { agent: string; successRate: number }[];
}

export class SessionSummarizer {
  generate(snapshot: AnalyticsSnapshot): SessionSummary {
    const total = snapshot.summary.totalTasks;
    const completed = snapshot.summary.totalCompleted;
    const failed = snapshot.summary.totalFailed;
    const agents = snapshot.agentStats;

    const sortedByRate = [...agents]
      .map((a) => ({
        agent: a.agentName,
        successRate: a.totalTasks > 0 ? a.completedTasks / a.totalTasks : 0,
      }))
      .sort((a, b) => b.successRate - a.successRate);

    const mostUsed = [...agents].sort((a, b) => b.totalTasks - a.totalTasks)[0] ?? null;

    return {
      totalTasks: total,
      completedTasks: completed,
      failedTasks: failed,
      successRate: total > 0 ? completed / total : 0,
      avgDuration: this.fmtDuration(
        snapshot.recentDurations.length > 0
          ? snapshot.recentDurations.reduce((s, d) => s + d.durationMs, 0) / snapshot.recentDurations.length
          : 0
      ),
      agentsUsed: agents.length,
      agentNames: agents.map((a) => a.agentName),
      mostUsedAgent: mostUsed?.agentName ?? null,
      totalEstimatedCost: snapshot.costEstimate.reduce((s, c) => s + c.estimatedCostUsd, 0),
      uptime: this.fmtDuration(snapshot.summary.uptimeMs),
      topPerformers: sortedByRate.slice(0, 3),
    };
  }

  private fmtDuration(ms: number): string {
    if (ms <= 0) return "0s";
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    const sec = s % 60;
    if (m < 60) return `${m}m ${sec}s`;
    const h = Math.floor(m / 60);
    return `${h}h ${m % 60}m`;
  }
}
