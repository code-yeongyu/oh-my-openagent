import { z } from "zod"

const CircuitBreakerConfigSchema = z.object({
  enabled: z.boolean().optional(),
  maxToolCalls: z.number().int().min(10).optional(),
  consecutiveThreshold: z.number().int().min(5).optional(),
})

export const BackgroundTaskConfigSchema = z.object({
  defaultConcurrency: z.number().min(1).optional(),
  providerConcurrency: z.record(z.string(), z.number().min(0)).optional(),
  modelConcurrency: z.record(z.string(), z.number().min(0)).optional(),
  maxDepth: z.number().int().min(1).optional(),
  maxDescendants: z.number().int().min(1).optional(),
  /** Stale timeout in milliseconds - interrupt tasks with no activity for this duration (default: 180000 = 3 minutes, minimum: 60000 = 1 minute) */
  staleTimeoutMs: z.number().min(60000).optional(),
  /** Timeout for tasks that never received any progress update, falling back to startedAt (default: 1800000 = 30 minutes, minimum: 60000 = 1 minute) */
  messageStalenessTimeoutMs: z.number().min(60000).optional(),
  syncPollTimeoutMs: z.number().min(60000).optional(),
  /** Maximum tool calls per subagent task before circuit breaker triggers (default: 200, minimum: 10). Prevents runaway loops from burning unlimited tokens. */
  maxToolCalls: z.number().int().min(10).optional(),
  circuitBreaker: CircuitBreakerConfigSchema.optional(),
})

export type BackgroundTaskConfig = z.infer<typeof BackgroundTaskConfigSchema>
