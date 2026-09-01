import * as z from "zod"

import { OmoReasoningEffortSchema, normalizeLegacyModelFields } from "./fallback-models"
import { OmoReasoningSchema } from "./model-ref"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

const OmoModelCatalogEntryInputSchema = z.object({
  model: z.string(),
  reasoning: OmoReasoningSchema.optional(),
  /** @deprecated Use reasoning. */
  variant: z.string().optional(),
  /** @deprecated Use reasoning. */
  reasoningEffort: OmoReasoningEffortSchema.optional(),
}).strict()

export const OmoModelCatalogEntrySchema = z.preprocess(
  (value) => isRecord(value) ? normalizeLegacyModelFields(value) : value,
  OmoModelCatalogEntryInputSchema,
)

export const OmoModelCatalogSchema = z.record(z.string(), OmoModelCatalogEntrySchema)

const OmoModelCatalogEntryLayerInputSchema = OmoModelCatalogEntryInputSchema.partial()
export const OmoModelCatalogEntryLayerSchema = z.preprocess(
  (value) => isRecord(value) ? normalizeLegacyModelFields(value) : value,
  OmoModelCatalogEntryLayerInputSchema,
)
export const OmoModelCatalogLayerSchema = z.record(z.string(), OmoModelCatalogEntryLayerSchema)

export type OmoModelCatalogEntry = z.infer<typeof OmoModelCatalogEntrySchema>
export type OmoModelCatalog = z.infer<typeof OmoModelCatalogSchema>
export type OmoModelCatalogEntryLayer = z.infer<typeof OmoModelCatalogEntryLayerSchema>
export type OmoModelCatalogLayer = z.infer<typeof OmoModelCatalogLayerSchema>
