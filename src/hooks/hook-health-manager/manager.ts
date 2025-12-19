import type {
  HookHealthState,
  HookHealthConfig,
  HookHealthSummary,
  HookLatencyMetrics,
  HookExecutionResult,
} from "./types";
import { DEFAULT_HOOK_HEALTH_CONFIG } from "./constants";
import { log } from "../../shared";

function createEmptyMetrics(): HookLatencyMetrics {
  return {
    avgLatencyMs: 0,
    maxLatencyMs: 0,
    p95LatencyMs: 0,
    latencySamples: [],
  };
}

function createInitialState(hookName: string): HookHealthState {
  return {
    hookName,
    consecutiveFailures: 0,
    totalInvocations: 0,
    totalErrors: 0,
    isDisabled: false,
    metrics: createEmptyMetrics(),
  };
}

function calculateP95(samples: number[]): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const index = Math.ceil(sorted.length * 0.95) - 1;
  return sorted[Math.max(0, index)];
}

function updateLatencyMetrics(
  metrics: HookLatencyMetrics,
  latencyMs: number,
  retentionCount: number
): void {
  metrics.latencySamples.push(latencyMs);
  if (metrics.latencySamples.length > retentionCount) {
    metrics.latencySamples.shift();
  }

  const samples = metrics.latencySamples;
  metrics.avgLatencyMs = samples.reduce((a, b) => a + b, 0) / samples.length;
  metrics.maxLatencyMs = Math.max(...samples);
  metrics.p95LatencyMs = calculateP95(samples);
}

export class HookHealthManager {
  private static instance: HookHealthManager | null = null;
  private states: Map<string, HookHealthState> = new Map();
  private config: HookHealthConfig;

  private constructor(config?: Partial<HookHealthConfig>) {
    this.config = { ...DEFAULT_HOOK_HEALTH_CONFIG, ...config };
  }

  static getInstance(config?: Partial<HookHealthConfig>): HookHealthManager {
    if (!HookHealthManager.instance) {
      HookHealthManager.instance = new HookHealthManager(config);
    }
    return HookHealthManager.instance;
  }

  static resetInstance(): void {
    HookHealthManager.instance = null;
  }

  private getOrCreateState(hookName: string): HookHealthState {
    let state = this.states.get(hookName);
    if (!state) {
      state = createInitialState(hookName);
      this.states.set(hookName, state);
    }
    return state;
  }

  isHookEnabled(hookName: string): boolean {
    const state = this.states.get(hookName);
    return !state?.isDisabled;
  }

  recordSuccess(hookName: string, latencyMs: number): void {
    const state = this.getOrCreateState(hookName);
    state.totalInvocations++;
    state.consecutiveFailures = 0;

    if (this.config.enableMetrics) {
      updateLatencyMetrics(state.metrics, latencyMs, this.config.metricsRetentionCount);
    }
  }

  recordFailure(hookName: string, error: Error): void {
    const state = this.getOrCreateState(hookName);
    state.totalInvocations++;
    state.totalErrors++;
    state.consecutiveFailures++;
    state.lastError = {
      message: error.message,
      timestamp: Date.now(),
      stack: error.stack,
    };

    if (state.consecutiveFailures >= this.config.circuitBreakerThreshold) {
      state.isDisabled = true;
      state.disabledAt = Date.now();

      if (this.config.logWarnings) {
        log(
          `[HookHealthManager] Hook "${hookName}" disabled after ${state.consecutiveFailures} consecutive failures`,
          { lastError: error.message }
        );
      }
    }
  }

  async executeWithHealth<T>(
    hookName: string,
    fn: () => Promise<T> | T
  ): Promise<HookExecutionResult & { result?: T }> {
    if (!this.isHookEnabled(hookName)) {
      return {
        success: false,
        latencyMs: 0,
        skipped: true,
        skipReason: `Hook "${hookName}" is disabled due to circuit breaker`,
      };
    }

    const startTime = performance.now();
    try {
      const result = await fn();
      const latencyMs = performance.now() - startTime;
      this.recordSuccess(hookName, latencyMs);
      return { success: true, latencyMs, result };
    } catch (error) {
      const latencyMs = performance.now() - startTime;
      this.recordFailure(hookName, error instanceof Error ? error : new Error(String(error)));
      return {
        success: false,
        latencyMs,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }

  getHealthSummary(): HookHealthSummary {
    const states = Array.from(this.states.values());
    const disabledHooks = states.filter((s) => s.isDisabled).map((s) => s.hookName);

    const slowestHooks = states
      .filter((s) => s.metrics.avgLatencyMs > 0)
      .sort((a, b) => b.metrics.avgLatencyMs - a.metrics.avgLatencyMs)
      .slice(0, 5)
      .map((s) => ({ name: s.hookName, avgLatencyMs: s.metrics.avgLatencyMs }));

    const mostErrorProne = states
      .filter((s) => s.totalInvocations > 0)
      .map((s) => ({
        name: s.hookName,
        errorRate: s.totalErrors / s.totalInvocations,
      }))
      .filter((s) => s.errorRate > 0)
      .sort((a, b) => b.errorRate - a.errorRate)
      .slice(0, 5);

    const totalInvocations = states.reduce((sum, s) => sum + s.totalInvocations, 0);
    const totalErrors = states.reduce((sum, s) => sum + s.totalErrors, 0);
    const allLatencies = states.flatMap((s) => s.metrics.latencySamples);
    const avgLatencyMs =
      allLatencies.length > 0
        ? allLatencies.reduce((a, b) => a + b, 0) / allLatencies.length
        : 0;

    return {
      totalHooks: states.length,
      enabledHooks: states.length - disabledHooks.length,
      disabledHooks,
      slowestHooks,
      mostErrorProne,
      sessionStats: {
        totalInvocations,
        totalErrors,
        avgLatencyMs,
      },
    };
  }

  getSlowHooks(thresholdMs?: number): HookHealthState[] {
    const threshold = thresholdMs ?? this.config.slowHookThresholdMs;
    return Array.from(this.states.values()).filter(
      (s) => s.metrics.avgLatencyMs > threshold
    );
  }

  getErrorProneHooks(errorRateThreshold: number = 0.1): HookHealthState[] {
    return Array.from(this.states.values()).filter((s) => {
      if (s.totalInvocations === 0) return false;
      return s.totalErrors / s.totalInvocations > errorRateThreshold;
    });
  }

  getHookState(hookName: string): HookHealthState | undefined {
    return this.states.get(hookName);
  }

  enableHook(hookName: string): void {
    const state = this.states.get(hookName);
    if (state) {
      state.isDisabled = false;
      state.consecutiveFailures = 0;
      state.disabledAt = undefined;
    }
  }

  resetForNewSession(): void {
    this.states.clear();
  }

  updateConfig(config: Partial<HookHealthConfig>): void {
    this.config = { ...this.config, ...config };
  }

  getConfig(): HookHealthConfig {
    return { ...this.config };
  }
}
