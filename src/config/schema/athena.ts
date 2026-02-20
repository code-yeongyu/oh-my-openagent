import { z } from "zod"
import { parseModelString } from "../../tools/delegate-task/model-string-parser"

/** Validates model string format: "provider/model-id" (e.g., "openai/gpt-5.3-codex"). */
const ModelStringSchema = z
  .string()
  .min(1)
  .refine(
    (model) => parseModelString(model) !== undefined,
    { message: 'Model must be in "provider/model-id" format (e.g., "openai/gpt-5.3-codex")' }
  )

export const CouncilMemberSchema = z.object({
  model: ModelStringSchema,
  variant: z.string().optional(),
  name: z.string().min(1).trim().regex(/^[a-zA-Z0-9][a-zA-Z0-9 .\-]*$/, {
    message: "Council member name must contain only letters, numbers, spaces, hyphens, and dots",
  }),
  temperature: z.number().min(0).max(2).optional(),
}).strict()

export const CouncilConfigSchema = z.object({
  members: z.array(CouncilMemberSchema).min(2),
}).strict()

export type CouncilMemberConfig = z.infer<typeof CouncilMemberSchema>
export type CouncilConfig = z.infer<typeof CouncilConfigSchema>

export const AthenaConfigSchema = z.object({
  council: CouncilConfigSchema,
}).strict()
