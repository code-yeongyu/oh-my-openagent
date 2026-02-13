import { z } from "zod"

/** Validates model string format: "provider/model-id" (e.g., "openai/gpt-5.3-codex"). */
const ModelStringSchema = z
  .string()
  .min(1)
  .refine(
    (model) => {
      const slashIndex = model.indexOf("/")
      return slashIndex > 0 && slashIndex < model.length - 1
    },
    { message: 'Model must be in "provider/model-id" format (e.g., "openai/gpt-5.3-codex")' }
  )

export const CouncilMemberSchema = z.object({
  model: ModelStringSchema,
  temperature: z.number().min(0).max(2).optional(),
  variant: z.string().optional(),
  name: z.string().optional(),
})

export const CouncilConfigSchema = z.object({
  members: z.array(CouncilMemberSchema).min(2),
})

export const AthenaConfigSchema = z.object({
  model: z.string().optional(),
  council: CouncilConfigSchema,
})

export type CouncilMemberSchemaType = z.infer<typeof CouncilMemberSchema>
export type CouncilConfigSchemaType = z.infer<typeof CouncilConfigSchema>
export type AthenaConfigSchemaType = z.infer<typeof AthenaConfigSchema>
