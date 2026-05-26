
export interface AgentStats {
  agentName: string;
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  totalDurationMs: number;
  activeTimeMs: number;
  lastActivity: number;
  toolCalls: number;
}

export interface TaskDurationSample {
  taskId: string;
  agent: string;
  durationMs: number;
  timestamp: number;
  kind: "task:completed" | "task:error";
}

export interface HeatmapCell {
  agentName: string;
  timeBucket: number; // unix epoch ms, bucketed to minute
  intensity: number; // 0-1 normalized
  eventCount: number;
}

export interface AnalyticsSnapshot {
  agentStats: AgentStats[];
  recentDurations: TaskDurationSample[];
  heatmap: HeatmapCell[];
  successRate: { agent: string; rate: number; total: number; failed: number }[];
  costEstimate: { agent: string; estimatedTokens: number; estimatedCostUsd: number }[];
  summary: {
    totalTasks: number;
    totalCompleted: number;
    totalFailed: number;
    avgDurationMs: number;
    uptimeMs: number;
  };
}
