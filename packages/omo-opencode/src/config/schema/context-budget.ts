import { z } from "zod"

export const ContextBudgetConfigSchema = z.object({
  max_active_context_tokens: z.number().int().min(1).optional(),
  keep_recent_tokens: z.number().int().min(1).optional(),
  warmup_fraction: z.number().min(0.01).max(1.0).optional(),
  target_active_fraction: z.number().min(0.01).max(1.0).optional(),
  reserve_tokens: z.number().int().min(0).optional(),
})

export type ContextBudgetConfig = z.infer<typeof ContextBudgetConfigSchema>
