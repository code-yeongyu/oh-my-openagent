import { z } from "zod"

export const FallbackModelsSchema = z.union([z.string(), z.array(z.string())])

export type FallbackModels = z.infer<typeof FallbackModelsSchema>
