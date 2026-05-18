import { z } from "zod"

export const OmoaProviderStateSchema = z.object({
  enabled: z.boolean().default(true),
  free_only: z.boolean().default(false),
  avoid_fallback_from: z.array(z.string()).default([]),
})
export type OmoaProviderState = z.infer<typeof OmoaProviderStateSchema>

export const OmoaStateSchema = z.object({
  version: z.literal(1),
  providers: z.record(z.string(), OmoaProviderStateSchema).default({}),
  banned_models: z.array(z.string()).default([]),
  deprecated_models: z.array(z.string()).default([]),
  active_preset: z.enum(["balanced", "emergency-free", "custom"]).default("balanced"),
})
export type OmoaState = z.infer<typeof OmoaStateSchema>

export const DEFAULT_OMOA_STATE: OmoaState = {
  version: 1,
  providers: {},
  banned_models: [],
  deprecated_models: [],
  active_preset: "balanced",
}
