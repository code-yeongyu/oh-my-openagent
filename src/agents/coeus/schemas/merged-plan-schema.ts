import { z } from 'zod'
import { TaskSchema } from './sub-plan-schema'

export const MergedPlanSchema = z.object({
  title: z.string(),
  context: z.string(),
  domains: z.array(z.string()),
  tasks: z.array(TaskSchema),
  waves: z.array(
    z.object({
      wave: z.number(),
      task_ids: z.array(z.string()),
    })
  ),
  dependency_graph: z.record(z.string(), z.array(z.string())),
  global_constraints: z.string(),
  conflicts_resolved: z.array(z.string()).optional(),
})

export type MergedPlan = z.infer<typeof MergedPlanSchema>
