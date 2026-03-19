import { z } from "zod"

export const SisyphusAgentConfigSchema = z.object({
  disabled: z.boolean().optional(),
  default_builder_enabled: z.boolean().optional(),
  planner_enabled: z.boolean().optional(),
  replace_plan: z.boolean().optional(),
  archive_completed_plans: z.boolean().optional(),
  archive_path: z.string().optional(),
})

export type SisyphusAgentConfig = z.infer<typeof SisyphusAgentConfigSchema>
