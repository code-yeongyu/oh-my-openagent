import { availableParallelism } from "node:os"

import * as z from "zod"

const ResidencyMaxChildrenInputSchema = z.union([z.number().int().positive(), z.literal("unlimited")])

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

export const OmoTaskWarningsSchema = z.object({
  unavailable_categories: z.boolean().default(true),
}).strict()

export const OmoTaskSettingsSchema = z.object({
  default_execution_mode: z.enum(["in-process", "process"]).default("in-process"),
  default_concurrency: z.number().int().positive().default(5),
  provider_concurrency: z.record(z.string(), z.number().int().positive()).optional(),
  model_concurrency: z.record(z.string(), z.number().int().positive()).optional(),
  max_depth: z.number().int().nonnegative().default(1),
  residency_max_children: ResidencyMaxChildrenInputSchema.default(8),
  ttl_ms: z.number().int().positive().default(86400000),
  state_dir: z.string().optional(),
  reattach_on_reconcile: z.boolean().optional(),
  resume_children: z.boolean().default(true),
  warnings: OmoTaskWarningsSchema.default({ unavailable_categories: true }),
  wait: OmoTaskWaitSchema.default({ min_ms: 5000, default_ms: 60000, max_ms: 600000 }),
  team: OmoTaskTeamSettingsSchema.default({
    max_members: 8,
    max_parallel_members: 4,
    max_wall_clock_minutes: 120,
  }),
}).strict()

export const OmoTaskWaitLayerSchema = z.object({
  min_ms: z.number().int().positive().optional(),
  default_ms: z.number().int().positive().optional(),
  max_ms: z.number().int().positive().optional(),
}).strict()

export const OmoTaskTeamSettingsLayerSchema = z.object({
  max_members: z.number().int().min(1).max(8).optional(),
  max_parallel_members: z.number().int().min(1).max(8).optional(),
  max_wall_clock_minutes: z.number().int().positive().optional(),
}).strict()

export const OmoTaskWarningsLayerSchema = z.object({
  unavailable_categories: z.boolean().optional(),
}).strict()

export const OmoTaskSettingsLayerSchema = z.object({
  default_execution_mode: z.enum(["in-process", "process"]).optional(),
  default_concurrency: z.number().int().positive().optional(),
  provider_concurrency: z.record(z.string(), z.number().int().positive()).optional(),
  model_concurrency: z.record(z.string(), z.number().int().positive()).optional(),
  max_depth: z.number().int().nonnegative().optional(),
  residency_max_children: ResidencyMaxChildrenInputSchema.optional(),
  ttl_ms: z.number().int().positive().optional(),
  state_dir: z.string().optional(),
  reattach_on_reconcile: z.boolean().optional(),
  resume_children: z.boolean().optional(),
  warnings: OmoTaskWarningsLayerSchema.optional(),
  wait: OmoTaskWaitLayerSchema.optional(),
  team: OmoTaskTeamSettingsLayerSchema.optional(),
}).strict()

export type OmoTaskSettings = z.infer<typeof OmoTaskSettingsSchema>
export type OmoTaskSettingsLayer = z.infer<typeof OmoTaskSettingsLayerSchema>

export function resolveOmoTaskSettings(
  input: unknown,
  resolveParallelism: () => number = availableParallelism,
): OmoTaskSettings {
  const record = z.record(z.string(), z.unknown()).parse(input)
  return OmoTaskSettingsSchema.parse({
    ...record,
    residency_max_children: record["residency_max_children"] ?? Math.max(8, resolveParallelism() * 3),
  })
}
