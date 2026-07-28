import * as z from "zod"

import { OmoReasoningEffortSchema } from "./fallback-models"

export const OmoModelCatalogEntrySchema = z.object({
  model: z.string(),
  variant: z.string().optional(),
  reasoningEffort: OmoReasoningEffortSchema.optional(),
}).strict()

export const OmoModelCatalogSchema = z.record(z.string(), OmoModelCatalogEntrySchema)

export const OmoModelCatalogEntryLayerSchema = OmoModelCatalogEntrySchema.partial()
export const OmoModelCatalogLayerSchema = z.record(z.string(), OmoModelCatalogEntryLayerSchema)

export type OmoModelCatalogEntry = z.infer<typeof OmoModelCatalogEntrySchema>
export type OmoModelCatalog = z.infer<typeof OmoModelCatalogSchema>
export type OmoModelCatalogEntryLayer = z.infer<typeof OmoModelCatalogEntryLayerSchema>
export type OmoModelCatalogLayer = z.infer<typeof OmoModelCatalogLayerSchema>
