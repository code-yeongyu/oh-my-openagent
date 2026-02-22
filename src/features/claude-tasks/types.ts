import { z } from "zod"

export const TaskStatusSchema = z.enum(["pending", "in_progress", "completed", "deleted"])
export type TaskStatus = z.infer<typeof TaskStatusSchema>

export const TaskSchema = z
  .object({
    id: z.string(),
    subject: z.string(),
    description: z.string(),
    status: TaskStatusSchema,
    activeForm: z.string().optional(),
    blocks: z.array(z.string()),
    blockedBy: z.array(z.string()),
    owner: z.string().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict()

export type Task = z.infer<typeof TaskSchema>
