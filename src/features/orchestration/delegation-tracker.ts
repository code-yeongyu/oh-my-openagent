import type { DelegationRecord, DelegationTrackerConfig, DelegationCheckResult } from "./types";
import { log } from "../../shared";

const DEFAULT_CONFIG: DelegationTrackerConfig = {
  maxDepth: 5,
  detectLoops: true,
  warnOnDeepChain: true,
  deepChainThreshold: 3,
};

export class DelegationTracker {
  private static instance: DelegationTracker | null = null;
  private history: DelegationRecord[] = [];
  private config: DelegationTrackerConfig;
  private currentSessionId: string | null = null;

  private constructor(config?: Partial<DelegationTrackerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  static getInstance(config?: Partial<DelegationTrackerConfig>): DelegationTracker {
    if (!DelegationTracker.instance) {
      DelegationTracker.instance = new DelegationTracker(config);
    }
    return DelegationTracker.instance;
  }

  static resetInstance(): void {
    DelegationTracker.instance = null;
  }

  setSessionId(sessionId: string): void {
    if (this.currentSessionId !== sessionId) {
      this.currentSessionId = sessionId;
      this.history = [];
    }
  }

  canDelegate(fromAgent: string, toAgent: string): DelegationCheckResult {
    const depth = this.getDepth();

    if (depth >= this.config.maxDepth) {
      return {
        allowed: false,
        reason: `Maximum delegation depth (${this.config.maxDepth}) reached. Current chain: ${this.getChainString()}`,
        depth,
        history: [...this.history],
      };
    }

    if (this.config.detectLoops) {
      const loopDetected = this.detectLoop(fromAgent, toAgent);
      if (loopDetected) {
        return {
          allowed: false,
          reason: `Delegation loop detected: ${fromAgent} → ${toAgent} would create a cycle. Chain: ${this.getChainString()} → ${toAgent}`,
          depth,
          history: [...this.history],
        };
      }
    }

    if (this.config.warnOnDeepChain && depth >= this.config.deepChainThreshold) {
      log(`[DelegationTracker] Warning: Deep delegation chain (depth ${depth + 1}): ${this.getChainString()} → ${toAgent}`);
    }

    return {
      allowed: true,
      depth: depth + 1,
      history: [...this.history],
    };
  }

  recordDelegation(fromAgent: string, toAgent: string, sessionId?: string): void {
    const record: DelegationRecord = {
      fromAgent,
      toAgent,
      timestamp: Date.now(),
      depth: this.getDepth() + 1,
      sessionId: sessionId || this.currentSessionId || "unknown",
    };
    this.history.push(record);
    log(`[DelegationTracker] Recorded: ${fromAgent} → ${toAgent} (depth: ${record.depth})`);
  }

  private detectLoop(fromAgent: string, toAgent: string): boolean {
    const agentsInChain = new Set<string>();
    
    for (const record of this.history) {
      agentsInChain.add(record.fromAgent);
      agentsInChain.add(record.toAgent);
    }
    agentsInChain.add(fromAgent);

    return agentsInChain.has(toAgent);
  }

  getDepth(): number {
    return this.history.length;
  }

  getHistory(): DelegationRecord[] {
    return [...this.history];
  }

  getChainString(): string {
    if (this.history.length === 0) {
      return "(empty)";
    }
    const agents = [this.history[0].fromAgent];
    for (const record of this.history) {
      agents.push(record.toAgent);
    }
    return agents.join(" → ");
  }

  popDelegation(): DelegationRecord | undefined {
    return this.history.pop();
  }

  reset(): void {
    this.history = [];
    this.currentSessionId = null;
  }

  updateConfig(config: Partial<DelegationTrackerConfig>): void {
    this.config = { ...this.config, ...config };
  }

  getConfig(): DelegationTrackerConfig {
    return { ...this.config };
  }
}
