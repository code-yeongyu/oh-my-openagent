import { z } from "zod"

export const StartWorkConfigSchema = z.object({
  /** Legacy compatibility flag. Atlas reminder flow no longer emits direct commit instructions. */
  auto_commit: z.boolean().default(true),
})

export type StartWorkConfig = z.infer<typeof StartWorkConfigSchema>
