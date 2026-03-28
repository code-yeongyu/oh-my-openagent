import { z } from "zod"

export const SisyphusAgentConfigSchema = z.object({
  disabled: z.boolean().optional(),
  default_builder_enabled: z.boolean().optional(),
  planner_enabled: z.boolean().optional(),
  replace_plan: z.boolean().optional(),
  /** Enable TDD-oriented planning for plan agent prompts (default: true) */
  tdd: z.boolean().default(true),
})

export type SisyphusAgentConfig = z.infer<typeof SisyphusAgentConfigSchema>
