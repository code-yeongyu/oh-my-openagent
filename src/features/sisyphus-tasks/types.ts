import { z } from "zod"

export const TaskStatusSchema = z.enum(["pending", "in_progress", "completed"])
export type TaskStatus = z.infer<typeof TaskStatusSchema>

export const TaskSchema = z.object({
  id: z.string(),
  subject: z.string(),
  description: z.string(),
  activeForm: z.string().optional(),
  owner: z.string().optional(),
  status: TaskStatusSchema,
  blocks: z.array(z.string()),
  blockedBy: z.array(z.string()),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

export type Task = z.infer<typeof TaskSchema>

export const TaskCreateInputSchema = z.object({
  subject: z.string().describe("Task title"),
  description: z.string().describe("Detailed description"),
  activeForm: z.string().optional().describe("Text shown when in progress"),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

export type TaskCreateInput = z.infer<typeof TaskCreateInputSchema>

export const TaskUpdateInputSchema = z.object({
  taskId: z.string().describe("Task ID to update"),
  subject: z.string().optional(),
  description: z.string().optional(),
  activeForm: z.string().optional(),
  status: z.enum(["pending", "in_progress", "completed", "deleted"]).optional(),
  addBlocks: z.array(z.string()).optional().describe("Task IDs this task will block"),
  addBlockedBy: z.array(z.string()).optional().describe("Task IDs that block this task"),
  owner: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

export type TaskUpdateInput = z.infer<typeof TaskUpdateInputSchema>
