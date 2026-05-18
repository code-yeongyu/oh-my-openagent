import { z } from "zod"

export const ModelRankingEntrySchema = z.object({
  model: z.string(),
  variant: z.string().optional(),
})
export type ModelRankingEntry = z.infer<typeof ModelRankingEntrySchema>

export const OmoaRankingsSchema = z.object({
  version: z.literal(1),
  agents: z.record(z.string(), z.array(ModelRankingEntrySchema)).default({}),
  categories: z.record(z.string(), z.array(ModelRankingEntrySchema)).default({}),
  fallback_provider_order: z.array(z.string()).default([]),
})
export type OmoaRankings = z.infer<typeof OmoaRankingsSchema>

export const DEFAULT_OMOA_RANKINGS: OmoaRankings = {
  version: 1,
  agents: {},
  categories: {},
  fallback_provider_order: [],
}
