import { z } from "zod"

export const RalphLoopConfigSchema = z.object({
  enabled: z.boolean().default(false),
  default_max_iterations: z.number().min(1).max(1000).default(100),
  /** Custom state file directory relative to project root (default: .opencode/) */
  state_dir: z.string().optional(),
  default_strategy: z.enum(["reset", "continue"]).default("continue"),
})

export type RalphLoopConfig = z.infer<typeof RalphLoopConfigSchema>
