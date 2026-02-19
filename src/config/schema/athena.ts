import { z } from "zod"
import { parseModelString } from "../../agents/athena/model-parser"

/** Validates model string format: "provider/model-id" (e.g., "openai/gpt-5.3-codex"). */
const ModelStringSchema = z
  .string()
  .min(1)
  .refine(
    (model) => parseModelString(model) !== null,
    { message: 'Model must be in "provider/model-id" format (e.g., "openai/gpt-5.3-codex")' }
  )

export const CouncilMemberSchema = z.object({
  model: ModelStringSchema,
  variant: z.string().optional(),
  name: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
}).strict()

export const CouncilConfigSchema = z.object({
  members: z.array(CouncilMemberSchema).min(2),
}).strict()

export const AthenaConfigSchema = z.object({
  model: z.string().optional(),
  council: CouncilConfigSchema,
}).strict()
