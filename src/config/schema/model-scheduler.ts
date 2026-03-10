import { z } from "zod"

export const ModelSchedulerModeSchema = z.enum(["observe", "dry-run", "active"])

export const ModelSchedulerConfigSchema = z.object({
  enabled: z.boolean().optional(),
  interval_minutes: z.number().int().min(1).max(24 * 60).optional(),
  mode: ModelSchedulerModeSchema.optional(),
  preflight_on_session_created: z.boolean().optional(),
  failure_threshold: z.number().int().min(1).max(10).optional(),
  recovery_threshold: z.number().int().min(1).max(10).optional(),
  agent_cooldown_minutes: z.number().int().min(0).max(24 * 60).optional(),
  protect_manual_routing: z.boolean().optional(),
  probe_enabled: z.boolean().optional(),
  probe_timeout_ms: z.number().int().min(1000).max(300000).optional(),
  probe_max_latency_ms: z.number().int().min(100).max(300000).optional(),
})

export type ModelSchedulerMode = z.infer<typeof ModelSchedulerModeSchema>
export type ModelSchedulerConfig = z.infer<typeof ModelSchedulerConfigSchema>
