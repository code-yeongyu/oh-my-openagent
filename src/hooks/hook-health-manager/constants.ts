import type { HookHealthConfig } from "./types";

export const DEFAULT_HOOK_HEALTH_CONFIG: HookHealthConfig = {
  circuitBreakerThreshold: 3,
  slowHookThresholdMs: 1000,
  metricsRetentionCount: 100,
  enableMetrics: true,
  logWarnings: true,
};

export const HOOK_HEALTH_MANAGER_NAME = "hook-health-manager";
