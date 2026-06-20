import { z } from "zod"

export const CompactionConfigSchema = z.object({
  preemptive_threshold: z.number().min(0).max(1).default(0.78),
  cooldown_ms: z.number().int().min(0).default(60000),
  enabled: z.boolean().default(true),
})

export type CompactionConfig = z.infer<typeof CompactionConfigSchema>
