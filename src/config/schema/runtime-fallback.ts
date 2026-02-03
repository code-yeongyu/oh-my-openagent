import { z } from "zod"

export const RuntimeFallbackConfigSchema = z.object({
  enabled: z.boolean().default(true),
  retry_on_errors: z.array(z.number()).default([429, 503, 529]),
  max_fallback_attempts: z.number().min(1).max(10).default(3),
  cooldown_seconds: z.number().min(0).default(60),
  notify_on_fallback: z.boolean().default(true),
})

export type RuntimeFallbackConfig = z.infer<typeof RuntimeFallbackConfigSchema>
