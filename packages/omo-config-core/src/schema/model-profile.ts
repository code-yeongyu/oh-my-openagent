import * as z from "zod"

import { OmoFallbackModelObjectSchema, normalizeLegacyModelFields } from "./fallback-models"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * A model profile is a named, ordered model chain a human picks by intent ("Capable", "Deep work")
 * instead of by model id. It is NOT the `profiles` key: that one is a VSCode-style config-layer
 * overlay activated by `OMO_PROFILE`.
 *
 * `models` is optional on purpose. A layer that fails validation is rejected wholesale
 * (`loader/loader.ts` `readConfigSource`), so requiring at least one entry would make a
 * label-only override of a builtin profile (`"capable": { "display_name": "..." }`) drop the
 * user's whole `categories`/`agents`/`teams` layer. "No models after merging the builtins" is a
 * runtime report, not a schema error.
 */
const OmoModelProfileInputSchema = z.object({
  display_name: z.string().optional(),
  models: z.array(z.union([z.string(), OmoFallbackModelObjectSchema])).optional(),
}).strict()

export const OmoModelProfileSchema = z.preprocess(
  (value) => isRecord(value) ? normalizeLegacyModelFields(value) : value,
  OmoModelProfileInputSchema,
)

export const OmoModelProfilesSchema = z.record(z.string(), OmoModelProfileSchema)

const OmoModelProfileLayerInputSchema = OmoModelProfileInputSchema.partial()
export const OmoModelProfileLayerSchema = z.preprocess(
  (value) => isRecord(value) ? normalizeLegacyModelFields(value) : value,
  OmoModelProfileLayerInputSchema,
)
export const OmoModelProfilesLayerSchema = z.record(z.string(), OmoModelProfileLayerSchema)

export type OmoModelProfile = z.infer<typeof OmoModelProfileSchema>
export type OmoModelProfiles = z.infer<typeof OmoModelProfilesSchema>
export type OmoModelProfileLayer = z.infer<typeof OmoModelProfileLayerSchema>
export type OmoModelProfilesLayer = z.infer<typeof OmoModelProfilesLayerSchema>
