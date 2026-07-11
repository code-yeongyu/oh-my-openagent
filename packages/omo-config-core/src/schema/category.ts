import * as z from "zod"
import { OmoFallbackModelsSchema, OmoThinkingConfigSchema } from "./fallback-models"

/**
 * Category config intentionally keeps the OpenCode category key set verbatim.
 * Most `omo.json` keys are snake_case, but category parity requires the
 * existing camelCase keys: `topP`, `maxTokens`, `reasoningEffort`,
 * `textVerbosity`, and `thinking.budgetTokens`.
 */
const BaseCategoryConfigSchema = z.object({
  description: z.string().optional(),
  model: z.string().optional(),
  fallback_models: OmoFallbackModelsSchema.optional(),
  variant: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  topP: z.number().min(0).max(1).optional(),
  maxTokens: z.number().optional(),
  thinking: OmoThinkingConfigSchema.optional(),
  reasoningEffort: z.enum(["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"]).optional(),
  textVerbosity: z.enum(["low", "medium", "high"]).optional(),
  tools: z.record(z.string(), z.boolean()).optional(),
  prompt_append: z.string().optional(),
  max_prompt_tokens: z.number().int().positive().optional(),
  is_unstable_agent: z.boolean().optional(),
  disable: z.boolean().optional(),
})

export const OmoCategoryConfigSchema = BaseCategoryConfigSchema.extend({
  /** @deprecated Use `topP` instead. Will be removed in a future version. */
  top_p: z.number().min(0).max(1).optional(),
}).transform((val): z.infer<typeof BaseCategoryConfigSchema> => {
  const { top_p, topP, ...rest } = val
  if (top_p !== undefined && topP === undefined) {
    console.warn("[config] DEPRECATED: 'top_p' in category config is deprecated, use 'topP' instead")
  }
  const result: z.infer<typeof BaseCategoryConfigSchema> = { ...rest }
  const finalTopP = topP ?? top_p
  if (finalTopP !== undefined) {
    result.topP = finalTopP
  }
  return result
})

export const OmoCategoriesConfigSchema = z.record(z.string(), OmoCategoryConfigSchema)

export type OmoCategoryConfig = z.infer<typeof BaseCategoryConfigSchema>
export type OmoCategoriesConfig = z.infer<typeof OmoCategoriesConfigSchema>
