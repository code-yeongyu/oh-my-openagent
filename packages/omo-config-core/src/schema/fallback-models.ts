import * as z from "zod"

export const OmoThinkingConfigSchema = z.object({
  type: z.enum(["enabled", "disabled"]),
  budgetTokens: z.number().optional(),
}).strict()

/** Shared by category configs, fallback entries, and agent definitions so the levels never drift. */
export const OmoReasoningEffortSchema = z.enum(["none", "minimal", "low", "medium", "high", "xhigh", "max"])

export const OmoFallbackModelObjectSchema = z.object({
  model: z.string(),
  variant: z.string().optional(),
  reasoningEffort: OmoReasoningEffortSchema.optional(),
  temperature: z.number().min(0).max(2).optional(),
  top_p: z.number().min(0).max(1).optional(),
  maxTokens: z.number().optional(),
  thinking: OmoThinkingConfigSchema.optional(),
}).strict()

export const OmoFallbackModelsSchema = z.union([
  z.string(),
  z.array(z.string()),
  z.array(OmoFallbackModelObjectSchema),
  z.array(z.union([z.string(), OmoFallbackModelObjectSchema])),
])

export type OmoReasoningEffort = z.infer<typeof OmoReasoningEffortSchema>
export type OmoFallbackModelObject = z.infer<typeof OmoFallbackModelObjectSchema>
export type OmoFallbackModels = z.infer<typeof OmoFallbackModelsSchema>
