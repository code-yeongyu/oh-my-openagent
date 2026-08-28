import * as z from "zod"

const mode = z.enum(["off", "best-effort", "required"])
const languages = z.record(z.string(), z.boolean()).optional()

export const OmoFormatOnMutationLayerSchema = z.object({
  mode: mode.optional(),
  languages,
  maxFileBytes: z.number().int().positive().optional(),
  timeoutMs: z.number().int().positive().optional(),
}).strict()

export const OmoFormatOnMutationSchema = OmoFormatOnMutationLayerSchema.extend({
  mode: mode.default("best-effort"),
  maxFileBytes: z.number().int().positive().default(1_048_576),
  timeoutMs: z.number().int().positive().default(3_000),
}).strict()

export type OmoFormatOnMutation = z.infer<typeof OmoFormatOnMutationSchema>
export type OmoFormatOnMutationLayer = z.infer<typeof OmoFormatOnMutationLayerSchema>
