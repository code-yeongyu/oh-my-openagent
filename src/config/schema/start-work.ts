import { z } from "zod"

export const StartWorkConfigSchema = z.object({
  /** Enable auto-commit after each atomic task completion (default: true) */
  auto_commit: z.boolean().default(true),
})

export type StartWorkConfig = z.infer<typeof StartWorkConfigSchema>
