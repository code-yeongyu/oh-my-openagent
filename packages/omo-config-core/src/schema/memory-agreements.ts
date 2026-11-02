import * as z from "zod"

export const OMO_MEMORY_AGREEMENTS_DEFAULTS = { enabled: true, needs_human_threshold: 3, max_items: 64 } as const

export const OmoMemoryAgreementsSchema = z.object({
  enabled: z.boolean().default(OMO_MEMORY_AGREEMENTS_DEFAULTS.enabled),
  needs_human_threshold: z.number().int().min(1).default(OMO_MEMORY_AGREEMENTS_DEFAULTS.needs_human_threshold),
  max_items: z.number().int().min(8).max(256).default(OMO_MEMORY_AGREEMENTS_DEFAULTS.max_items),
}).strict()

export const OmoMemoryAgreementsLayerSchema = z.object({
  enabled: z.boolean().optional(),
  needs_human_threshold: z.number().int().min(1).optional(),
  max_items: z.number().int().min(8).max(256).optional(),
}).strict()

export type OmoMemoryAgreements = z.infer<typeof OmoMemoryAgreementsSchema>
