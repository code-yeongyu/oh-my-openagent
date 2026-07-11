import { z } from "zod"

const BaseFallbackModelObjectSchema = z.object({
  model: z.string(),
  variant: z.enum(["low", "medium", "high", "xhigh", "ultra", "max", "auto", "thinking", "minimal", "none"]).optional(),
  reasoningEffort: z.enum(["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"]).optional(),
  temperature: z.number().min(0).max(2).optional(),
  topP: z.number().min(0).max(1).optional(),
  maxTokens: z.number().optional(),
  thinking: z
    .object({
      type: z.enum(["enabled", "disabled"]),
      budgetTokens: z.number().optional(),
    })
    .optional(),
});

export const FallbackModelObjectSchema = BaseFallbackModelObjectSchema.extend({
  top_p: z.number().min(0).max(1).optional(),
}).transform((val): z.infer<typeof BaseFallbackModelObjectSchema> => {
  const { top_p, topP, ...rest } = val;
  if (top_p !== undefined && topP === undefined) {
    console.warn("[config] DEPRECATED: 'top_p' is deprecated, use 'topP' instead");
  }
  const result: z.infer<typeof BaseFallbackModelObjectSchema> = { ...rest };
  const finalTopP = topP ?? top_p;
  if (finalTopP !== undefined) {
    result.topP = finalTopP;
  }
  return result;
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
