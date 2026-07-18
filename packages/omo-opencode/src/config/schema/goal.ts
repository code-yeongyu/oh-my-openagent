import { z } from "zod"

export const GoalConfigSchema = z.object({
  /** Enable the Goal subsystem (default: false) */
  enabled: z.boolean().default(false),
  /** Automatically create a goal from the first main-session message, without requiring /goal. Equivalent to default_mode.goal; either flag enables first-message auto-start. */
  auto_start: z.boolean().default(false),
  /** Default continuation iteration cap, preserved for Ralph Loop behavioral parity (default: 100) */
  default_max_iterations: z.number().min(1).max(1000).default(100),
  /** Run goal continuation prompts in ultrawork mode, letting the goal autopilot trigger ultrawork on its own (independent of default_mode.ultrawork or the ultrawork keyword). */
  ultrawork: z.boolean().default(false),
})

export type GoalConfig = z.infer<typeof GoalConfigSchema>
