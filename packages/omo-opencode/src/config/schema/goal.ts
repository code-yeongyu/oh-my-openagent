import { z } from "zod"

export const GoalConfigSchema = z.object({
  /** Enable the Goal subsystem (default: false) */
  enabled: z.boolean().default(false),
  /** Automatically create a goal from the first main-session message when default_mode.goal is true. */
  auto_start: z.boolean().default(false),
  /** Default continuation iteration cap, preserved for Ralph Loop behavioral parity (default: 100) */
  default_max_iterations: z.number().min(1).max(1000).default(100),
})

export type GoalConfig = z.infer<typeof GoalConfigSchema>
