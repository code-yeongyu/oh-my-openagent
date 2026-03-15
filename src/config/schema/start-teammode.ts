import { z } from "zod"

export const StartTeammodeConfigSchema = z.object({
  /** Enable auto-commit after each atomic task completion while Atlas coordinates team mode. */
  auto_commit: z.boolean().default(true),
  /** Default worker count used by /start-teammode when --workers is omitted. */
  default_worker_count: z.number().int().min(1).max(16).default(3),
})

export type StartTeammodeConfig = z.infer<typeof StartTeammodeConfigSchema>
