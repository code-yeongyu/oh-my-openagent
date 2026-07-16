import * as z from "zod"

export const OmoTaskWaitSchema = z.object({
  min_ms: z.number().int().positive().default(5000),
  default_ms: z.number().int().positive().default(60000),
  max_ms: z.number().int().positive().default(600000),
}).strict()

export const OmoTaskTeamSettingsSchema = z.object({
  max_members: z.number().int().min(1).max(8).default(8),
  max_parallel_members: z.number().int().min(1).max(8).default(4),
  max_wall_clock_minutes: z.number().int().positive().default(120),
}).strict()

export const OmoTaskSettingsSchema = z.object({
  default_execution_mode: z.enum(["in-process", "process"]).default("in-process"),
  default_concurrency: z.number().int().positive().default(5),
  provider_concurrency: z.record(z.string(), z.number().int().positive()).optional(),
  model_concurrency: z.record(z.string(), z.number().int().positive()).optional(),
  max_depth: z.number().int().nonnegative().default(1),
  residency_max_children: z.number().int().positive().default(8),
  ttl_ms: z.number().int().positive().default(86400000),
  state_dir: z.string().optional(),
  reattach_on_reconcile: z.boolean().optional(),
  wait: OmoTaskWaitSchema.default({ min_ms: 5000, default_ms: 60000, max_ms: 600000 }),
  team: OmoTaskTeamSettingsSchema.default({
    max_members: 8,
    max_parallel_members: 4,
    max_wall_clock_minutes: 120,
  }),
}).strict()

export type OmoTaskSettings = z.infer<typeof OmoTaskSettingsSchema>
