import { z } from "zod"

export const FallbackModelObjectSchema = z
  .object({
    model: z.string(),
    variant: z.enum(["low", "medium", "high", "xhigh", "max", "auto", "thinking", "minimal", "none"]).optional(),
    reasoningEffort: z.enum(["none", "minimal", "low", "medium", "high", "xhigh", "max"]).optional(),
    temperature: z.number().min(0).max(2).optional(),
    topP: z.number().min(0).max(1).optional(),
    top_p: z.number().min(0).max(1).optional(),
    maxTokens: z.number().optional(),
    thinking: z
      .object({
        type: z.enum(["enabled", "disabled"]),
        budgetTokens: z.number().optional(),
      })
      .optional(),
  })
  .transform(({ top_p, topP, ...rest }) => {
    if (top_p !== undefined && topP === undefined) {
      console.warn("[config] DEPRECATED: 'top_p' is deprecated, use 'topP' instead");
    }
    return {
      ...rest,
      topP: topP ?? top_p,
    };
  });

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
