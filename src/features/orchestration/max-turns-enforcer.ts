import type { MaxTurnsConfig } from "./types";
import { log } from "../../shared";

const DEFAULT_CONFIG: MaxTurnsConfig = {
  maxTurns: 10,
  warnAtTurn: 8,
  includeToolCalls: false,
};

export class MaxTurnsEnforcer {
  private static instances: Map<string, MaxTurnsEnforcer> = new Map();
  private turnCount: number = 0;
  private config: MaxTurnsConfig;
  private sessionId: string;
  private workSummary: string[] = [];

  private constructor(sessionId: string, config?: Partial<MaxTurnsConfig>) {
    this.sessionId = sessionId;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  static getInstance(sessionId: string, config?: Partial<MaxTurnsConfig>): MaxTurnsEnforcer {
    let instance = MaxTurnsEnforcer.instances.get(sessionId);
    if (!instance) {
      instance = new MaxTurnsEnforcer(sessionId, config);
      MaxTurnsEnforcer.instances.set(sessionId, instance);
    }
    return instance;
  }

  static removeInstance(sessionId: string): void {
    MaxTurnsEnforcer.instances.delete(sessionId);
  }

  static resetAll(): void {
    MaxTurnsEnforcer.instances.clear();
  }

  incrementTurn(workDescription?: string): void {
    this.turnCount++;
    if (workDescription) {
      this.workSummary.push(`Turn ${this.turnCount}: ${workDescription}`);
    }
    
    if (this.turnCount === this.config.warnAtTurn) {
      log(`[MaxTurnsEnforcer] Session ${this.sessionId}: Approaching turn limit (${this.turnCount}/${this.config.maxTurns})`);
    }
  }

  isLimitReached(): boolean {
    return this.turnCount >= this.config.maxTurns;
  }

  getTurnCount(): number {
    return this.turnCount;
  }

  getRemainingTurns(): number {
    return Math.max(0, this.config.maxTurns - this.turnCount);
  }

  getSummary(): string {
    const lines = [
      `Session: ${this.sessionId}`,
      `Turns used: ${this.turnCount}/${this.config.maxTurns}`,
      "",
      "Work completed:",
    ];

    if (this.workSummary.length === 0) {
      lines.push("  (No work recorded)");
    } else {
      for (const item of this.workSummary) {
        lines.push(`  - ${item}`);
      }
    }

    return lines.join("\n");
  }

  getTerminationMessage(): string {
    return `⚠️ Maximum turns (${this.config.maxTurns}) reached for this session.

${this.getSummary()}

To continue, please start a new session or increase the max_turns limit.`;
  }

  addWorkItem(description: string): void {
    this.workSummary.push(description);
  }

  reset(): void {
    this.turnCount = 0;
    this.workSummary = [];
  }

  updateConfig(config: Partial<MaxTurnsConfig>): void {
    this.config = { ...this.config, ...config };
  }

  getConfig(): MaxTurnsConfig {
    return { ...this.config };
  }
}
