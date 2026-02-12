import { z } from "zod"

export const CouncilMemberSchema = z.object({
  model: z.string(),
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
