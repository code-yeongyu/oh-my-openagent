import { z } from "zod"

export const SisyphusAgentConfigSchema = z.object({
  disabled: z.boolean().optional(),
  default_builder_enabled: z.boolean().optional(),
  planner_enabled: z.boolean().optional(),
  replace_plan: z.boolean().optional(),
  tdd: z.boolean().default(true).optional(),
  /**
   * Opt-in: make eligible builtin subagents inherit Sisyphus's resolved `model`
   * and `variant`. Agents with an explicit `model`/`category`, a hard
   * model/provider requirement, or a special role (planner, orchestrator,
   * vision) keep their own resolution. Default: off.
   */
  inherit_model: z.boolean().optional(),
})

export type SisyphusAgentConfig = z.infer<typeof SisyphusAgentConfigSchema>
