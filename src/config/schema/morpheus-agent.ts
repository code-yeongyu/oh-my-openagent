import { z } from "zod"

export const MorpheusAgentConfigSchema = z.object({
  disabled: z.boolean().optional(),
  default_builder_enabled: z.boolean().optional(),
  planner_enabled: z.boolean().optional(),
  replace_plan: z.boolean().optional(),
})

export type MorpheusAgentConfig = z.infer<typeof MorpheusAgentConfigSchema>
