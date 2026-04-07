import { z } from "zod"

export const FallbackModelObjectSchema = z.object({
  model: z.string(),
  variant: z.string().optional(),
  reasoningEffort: z.enum(["none", "minimal", "low", "medium", "high", "xhigh"]).optional(),
  temperature: z.number().min(0).max(2).optional(),
  top_p: z.number().min(0).max(1).optional(),
  maxTokens: z.number().optional(),
  thinking: z
    .object({
      type: z.enum(["enabled", "disabled"]),
      budgetTokens: z.number().optional(),
    })
    .optional(),
  /**
   * When true, this fallback is used even if the previous model was stopped due to a
   * usage/quota limit. Without this flag, usage-limit errors cancel the task and notify
   * the parent instead of triggering an automatic (potentially billable) fallback.
   */
  ignore_usage_limit: z.boolean().optional(),
})

export type FallbackModelObject = z.infer<typeof FallbackModelObjectSchema>

export const FallbackModelStringArraySchema = z.array(z.string())
export const FallbackModelObjectArraySchema = z.array(FallbackModelObjectSchema)
export const FallbackModelMixedArraySchema = z.array(z.union([z.string(), FallbackModelObjectSchema]))

export const FallbackModelsSchema = z.union([
  z.string(),
  FallbackModelStringArraySchema,
  FallbackModelObjectArraySchema,
  FallbackModelMixedArraySchema,
])

export type FallbackModels = z.infer<typeof FallbackModelsSchema>
