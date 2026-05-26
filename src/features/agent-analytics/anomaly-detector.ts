import type { AnalyticsSnapshot } from "./types";

export interface AnomalyConfig {
  sameToolThreshold: number;
  stallThresholdMs: number;
}

export interface AnomalyResult {
  agentId: string;
  type: "tool-loop" | "stall";
  detail: string;
  confidence: number;
}

export class AnomalyDetector {
  private config: AnomalyConfig;
  private prevToolCalls = new Map<string, number>();

  constructor(config?: Partial<AnomalyConfig>) {
    this.config = {
      sameToolThreshold: config?.sameToolThreshold ?? 5,
      stallThresholdMs: config?.stallThresholdMs ?? 60_000,
    };
  }

  detect(snapshot: AnalyticsSnapshot): AnomalyResult[] {
    const results: AnomalyResult[] = [];
    const now = Date.now();

    for (const stat of snapshot.agentStats) {
      const lastActiveMs = now - stat.lastActivity;
      if (lastActiveMs > this.config.stallThresholdMs && stat.toolCalls === 0) {
        results.push({
          agentId: stat.agentName,
          type: "stall",
          detail: `No activity for ${Math.floor(lastActiveMs / 1000)}s`,
          confidence: 0.7,
        });
        continue;
      }

      const prev = this.prevToolCalls.get(stat.agentName) ?? 0;
      const newToolCalls = stat.toolCalls - prev;
      this.prevToolCalls.set(stat.agentName, stat.toolCalls);

      if (newToolCalls >= this.config.sameToolThreshold) {
        results.push({
          agentId: stat.agentName,
          type: "tool-loop",
          detail: `${newToolCalls} tool calls without progress`,
          confidence: 0.6,
        });
      }
    }
    return results;
  }

  reset(agentId?: string): void {
    if (agentId) {
      this.prevToolCalls.delete(agentId);
    } else {
      this.prevToolCalls.clear();
    }
  }
}
