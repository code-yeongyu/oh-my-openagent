/**
 * Hook Health Manager Types
 * 
 * Circuit breaker and health monitoring types for oh-my-opencode hooks.
 * Part of LIF-63: Hook Reliability, Safety & Orchestration Guardrails
 */

/**
 * Last error information for a hook
 */
export interface HookLastError {
  message: string;
  timestamp: number;
  stack?: string;
}

/**
 * Latency metrics for a hook
 */
export interface HookLatencyMetrics {
  avgLatencyMs: number;
  maxLatencyMs: number;
  p95LatencyMs: number;
  latencySamples: number[];
}

/**
 * Health state for a single hook
 */
export interface HookHealthState {
  hookName: string;
  consecutiveFailures: number;
  totalInvocations: number;
  totalErrors: number;
  isDisabled: boolean;
  disabledAt?: number;
  lastError?: HookLastError;
  metrics: HookLatencyMetrics;
}

/**
 * Configuration for the Hook Health Manager
 */
export interface HookHealthConfig {
  /** Number of consecutive failures before disabling hook (default: 3) */
  circuitBreakerThreshold: number;
  /** Latency threshold in ms to consider a hook "slow" (default: 1000) */
  slowHookThresholdMs: number;
  /** Number of latency samples to retain for metrics (default: 100) */
  metricsRetentionCount: number;
  /** Whether to collect and report metrics (default: true) */
  enableMetrics: boolean;
  /** Log warnings when hooks are disabled (default: true) */
  logWarnings: boolean;
}

/**
 * Summary of hook health across all hooks
 */
export interface HookHealthSummary {
  totalHooks: number;
  enabledHooks: number;
  disabledHooks: string[];
  slowestHooks: Array<{ name: string; avgLatencyMs: number }>;
  mostErrorProne: Array<{ name: string; errorRate: number }>;
  sessionStats: {
    totalInvocations: number;
    totalErrors: number;
    avgLatencyMs: number;
  };
}

/**
 * Result of a hook execution attempt
 */
export interface HookExecutionResult {
  success: boolean;
  latencyMs: number;
  error?: Error;
  skipped?: boolean;
  skipReason?: string;
}
