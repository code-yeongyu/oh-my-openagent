import { z } from "zod"

export const TaskStatusSchema = z.enum(["open", "in_progress", "completed"])
export type TaskStatus = z.infer<typeof TaskStatusSchema>

export const TaskObjectSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    description: z.string().optional(),
    status: TaskStatusSchema,
    dependsOn: z.array(z.string()).default([]),
    repoURL: z.string().optional(),
    parentID: z.string().optional(),
    threadID: z.string(),
  })
  .strict()

export type TaskObject = z.infer<typeof TaskObjectSchema>

// Action input schemas
export const TaskCreateInputSchema = z.object({
  title: z.string(),
  description: z.string().optional(),
  dependsOn: z.array(z.string()).optional(),
  repoURL: z.string().optional(),
  parentID: z.string().optional(),
})

export type TaskCreateInput = z.infer<typeof TaskCreateInputSchema>

export const TaskListInputSchema = z.object({
  status: TaskStatusSchema.optional(),
  parentID: z.string().optional(),
})

export type TaskListInput = z.infer<typeof TaskListInputSchema>

export const TaskGetInputSchema = z.object({
  id: z.string(),
})

export type TaskGetInput = z.infer<typeof TaskGetInputSchema>

export const TaskUpdateInputSchema = z.object({
  id: z.string(),
  title: z.string().optional(),
  description: z.string().optional(),
  status: TaskStatusSchema.optional(),
  dependsOn: z.array(z.string()).optional(),
  repoURL: z.string().optional(),
  parentID: z.string().optional(),
})

export type TaskUpdateInput = z.infer<typeof TaskUpdateInputSchema>

export const TaskDeleteInputSchema = z.object({
  id: z.string(),
})

export type TaskDeleteInput = z.infer<typeof TaskDeleteInputSchema>
