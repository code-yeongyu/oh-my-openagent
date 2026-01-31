import { z } from "zod"

export const ContextStrategySchema = z.enum(["reset", "continue"])

export const RalphLoopConfigSchema = z.object({
  /** Enable ralph loop functionality (default: false - opt-in feature) */
  enabled: z.boolean().default(false),
  /** Default max iterations if not specified in command (default: 100) */
  default_max_iterations: z.number().min(1).max(1000).default(100),
  /** Custom state file directory relative to project root (default: .opencode/) */
  state_dir: z.string().optional(),
  /**
   * Context management strategy between loop iterations (default: "reset")
   * - "reset": Create a new session with fresh context for each iteration (recommended)
   * - "continue": Keep same session and accumulate context across iterations
   */
  context_strategy: ContextStrategySchema.optional(),
})

export type RalphLoopConfig = z.infer<typeof RalphLoopConfigSchema>
export type ContextStrategy = z.infer<typeof ContextStrategySchema>
