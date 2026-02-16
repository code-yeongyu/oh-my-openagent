import { z } from "zod"

export const CouesConfigSchema = z.object({
  enabled: z.boolean().default(true),
  max_depth: z.number().min(1).max(3).default(1),
  max_sub_planners: z.number().min(1).max(10).default(5),
  cost_budget_tokens: z.number().optional(),
  decomposition_strategy: z.enum(["auto", "domain", "feature", "hybrid"]).default("auto"),
  sub_plan_storage_path: z.string().default(".sisyphus/sub-plans"),
})

export type CouesConfig = z.infer<typeof CouesConfigSchema>
