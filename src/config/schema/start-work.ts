import { z } from "zod"

export const StartWorkConfigSchema = z.object({
  /** Enable auto-commit after each atomic task completion (default: true) */
  auto_commit: z.boolean().default(true),
  /** Enable worktree enforcement for /start-work command (default: true) */
  worktree: z.boolean().default(true),
})

export type StartWorkConfig = z.infer<typeof StartWorkConfigSchema>
