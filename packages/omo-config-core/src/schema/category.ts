import * as z from "zod"
import { OmoFallbackModelsSchema, OmoThinkingConfigSchema } from "./fallback-models"

/**
 * Category config intentionally keeps the OpenCode category key set verbatim.
 * Most `omo.json` keys are snake_case, but category parity requires the
 * existing camelCase keys: `maxTokens`, `reasoningEffort`,
 * `textVerbosity`, and `thinking.budgetTokens`.
 */
export const OmoCategoryConfigSchema = z.object({
  description: z.string().optional(),
  model: z.string().optional(),
  fallback_models: OmoFallbackModelsSchema.optional(),
  variant: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  top_p: z.number().min(0).max(1).optional(),
  maxTokens: z.number().optional(),
  thinking: OmoThinkingConfigSchema.optional(),
  reasoningEffort: z.enum(["none", "minimal", "low", "medium", "high", "xhigh", "max"]).optional(),
  textVerbosity: z.enum(["low", "medium", "high"]).optional(),
  tools: z.record(z.string(), z.boolean()).optional(),
  prompt_append: z.string().optional(),
  max_prompt_tokens: z.number().int().positive().optional(),
  is_unstable_agent: z.boolean().optional(),
  disable: z.boolean().optional(),
}).strict()

export const OmoCategoriesConfigSchema = z.record(z.string(), OmoCategoryConfigSchema)

export type OmoCategoryConfig = z.infer<typeof OmoCategoryConfigSchema>
export type OmoCategoriesConfig = z.infer<typeof OmoCategoriesConfigSchema>
