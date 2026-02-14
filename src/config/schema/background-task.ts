import { z } from "zod"

export const BackgroundTaskConfigSchema = z.object({
  defaultConcurrency: z.number().min(1).optional(),
  providerConcurrency: z.record(z.string(), z.number().min(0)).optional(),
  modelConcurrency: z.record(z.string(), z.number().min(0)).optional(),
  /** Stale timeout in milliseconds - interrupt tasks with no activity for this duration (default: 180000 = 3 minutes, minimum: 60000 = 1 minute) */
  staleTimeoutMs: z.number().min(60000).optional(),
  /** Timeout for tasks that never received any progress update, falling back to startedAt (default: 600000 = 10 minutes, minimum: 60000 = 1 minute) */
  messageStalenessTimeoutMs: z.number().min(60000).optional(),
})

export type BackgroundTaskConfig = z.infer<typeof BackgroundTaskConfigSchema>
