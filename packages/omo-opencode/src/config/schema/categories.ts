import { OmoReasoningSchema } from "@oh-my-opencode/omo-config-core"
import { z } from "zod"
import { FallbackModelObjectSchema, FallbackModelsSchema } from "./fallback-models"

export const CategoryConfigSchema = z.object({
  /** Human-readable description of the category's purpose. Shown in task prompt. */
  description: z.string().optional(),
  model: z.string().optional(),
  /** Ordered model chain; the first entry is the primary model and the rest are fallbacks. */
  models: z.array(z.union([z.string(), FallbackModelObjectSchema])).optional(),
  /** @deprecated Use `models` instead. */
  fallback_models: FallbackModelsSchema.optional(),
  reasoning: OmoReasoningSchema.optional(),
  /** @deprecated Use `reasoning` instead. */
  variant: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  top_p: z.number().min(0).max(1).optional(),
  max_tokens: z.number().int().positive().optional(),
  /** Provider-specific request options passed through to the harness. */
  provider_options: z.record(z.string(), z.unknown()).optional(),
  /** @deprecated Use `max_tokens` instead. */
  maxTokens: z.number().optional(),
  thinking: z
    .object({
      type: z.enum(["enabled", "disabled"]),
      budgetTokens: z.number().optional(),
    })
    .optional(),
  /** @deprecated Use `reasoning` instead. */
  reasoningEffort: z.enum(["none", "minimal", "low", "medium", "high", "xhigh", "max"]).optional(),
  textVerbosity: z.enum(["low", "medium", "high"]).optional(),
  tools: z.record(z.string(), z.boolean()).optional(),
  prompt_append: z.string().optional(),
  max_prompt_tokens: z.number().int().positive().optional(),
  /** Mark agent as unstable - forces background mode for monitoring. Auto-enabled for gemini/minimax models. */
  is_unstable_agent: z.boolean().optional(),
  /** Disable this category. Disabled categories are excluded from task delegation. */
  disable: z.boolean().optional(),
  /** Suppress the warning shown when this category's model is unavailable. Mirrors omo-config-core. */
  warn_unavailable: z.boolean().optional(),
})

export const BuiltinCategoryNameSchema = z.enum([
  "visual-engineering",
  "ultrabrain",
  "deep",
  "artistry",
  "quick",
  "unspecified-low",
  "unspecified-high",
  "writing",
])

export const CategoriesConfigSchema = z.record(z.string(), CategoryConfigSchema)

export type CategoryConfig = z.infer<typeof CategoryConfigSchema>
export type CategoriesConfig = z.infer<typeof CategoriesConfigSchema>
export type BuiltinCategoryName = z.infer<typeof BuiltinCategoryNameSchema>
