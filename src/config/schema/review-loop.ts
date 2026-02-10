import { z } from "zod"

export const ReviewLoopConfigSchema = z.object({
  enabled: z.boolean().default(false),
  default_max_iterations: z.number().min(1).max(100).default(10),
  state_dir: z.string().optional(),
})

export type ReviewLoopConfig = z.infer<typeof ReviewLoopConfigSchema>
