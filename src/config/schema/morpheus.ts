import { z } from "zod"

const MorpheusTasksConfigSchema = z.object({
  /** Absolute or relative storage path override. When set, bypasses global config dir. */
  storage_path: z.string().optional(),
  /** Force task list ID (alternative to env ULTRAWORK_TASK_LIST_ID) */
  task_list_id: z.string().optional(),
  /** Enable Claude Code path compatibility mode */
  claude_code_compat: z.boolean().default(false),
})

export const MorpheusConfigSchema = z.object({
  tasks: MorpheusTasksConfigSchema.optional(),
})

export type MorpheusTasksConfig = z.infer<typeof MorpheusTasksConfigSchema>
export type MorpheusConfig = z.infer<typeof MorpheusConfigSchema>
