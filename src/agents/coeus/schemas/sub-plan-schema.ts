import { z } from 'zod'

export const TaskSchema = z.object({
  id: z.string(),
  title: z.string().min(1),
  description: z.string().min(1),
  depends_on: z.array(z.string()),
  category: z.string(),
  skills: z.array(z.string()),
  files_touched: z.array(z.string()),
  acceptance_criteria: z.array(z.string().min(1)).min(1),
  must_not_do: z.array(z.string()).optional(),
  qa_scenarios: z.array(z.string()).optional(),
})

export type Task = z.infer<typeof TaskSchema>

export const SubPlanSchema = z.object({
  domain: z.string().min(1),
  domain_description: z.string(),
  tasks: z.array(TaskSchema).min(1),
  wave_assignments: z.record(z.string(), z.number()),
  constraints_acknowledged: z.boolean(),
  source_sub_planner: z.string(),
})

export type SubPlan = z.infer<typeof SubPlanSchema>
