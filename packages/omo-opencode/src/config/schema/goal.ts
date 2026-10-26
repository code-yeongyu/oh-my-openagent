import { z } from "zod"

export const GoalConfigSchema = z.object({
  /** Enable the Goal subsystem (default: false) */
  enabled: z.boolean().default(false),
  /** Automatically create a goal from the first main-session message (default: true). default_mode.goal is a legacy alias. */
  auto_start: z.boolean().default(true),
  /** Default continuation iteration cap, preserved for Ralph Loop behavioral parity (default: 100) */
  default_max_iterations: z.number().min(1).max(1000).default(100),
  /** Require evidence text when completing a goal (default: true) */
  require_completion_evidence: z.boolean().default(true),
  /** Inherit active parent goals into delegated child sessions (default: true) */
  inherit_to_children: z.boolean().default(true),
  /** Consecutive error stalls before a goal auto-pauses (default: 3) */
  max_stalls: z.number().min(1).max(10).default(3),
})

export type GoalConfig = z.infer<typeof GoalConfigSchema>
