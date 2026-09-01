import { z } from "zod"

export const CommentCheckerConfigSchema = z.object({
  /** Custom prompt to replace the default warning message. Use {{comments}} placeholder for detected comments XML. */
  custom_prompt: z.string().optional(),
})

export type CommentCheckerConfig = z.infer<typeof CommentCheckerConfigSchema>
