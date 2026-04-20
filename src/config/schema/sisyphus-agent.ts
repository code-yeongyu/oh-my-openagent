import { z } from "zod"

export const SisyphusAgentConfigSchema = z.object({
  disabled: z.boolean().optional(),
  default_builder_enabled: z.boolean().optional(),
  planner_enabled: z.boolean().optional(),
  preserve_native_agents: z.array(z.enum(["build", "plan"])).optional(),
  replace_plan: z.boolean().optional(),
  tdd: z.boolean().default(true).optional(),
})

export type SisyphusAgentConfig = z.infer<typeof SisyphusAgentConfigSchema>
