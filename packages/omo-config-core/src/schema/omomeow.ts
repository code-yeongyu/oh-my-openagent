import * as z from "zod"

import type { OmoHarnessId } from "./harness"

export const OMOMEOW_LANGUAGES = ["en", "ko"] as const

const OmoMeowNudgeShape = {
  /** Send the periodic "what is running" DM (default: true). */
  enabled: z.boolean(),
  /** Minutes between nudges (default: 30), the interval of the nudge timer service. */
  interval_minutes: z.number().int().min(1).max(1440),
}

export const OmoMeowNudgeLayerSchema = z.object(OmoMeowNudgeShape).partial().strict()

export const OmoMeowNudgeSchema = OmoMeowNudgeLayerSchema.extend({
  enabled: z.boolean().default(true),
  interval_minutes: z.number().int().min(1).max(1440).default(30),
}).strict()

export const OmoMeowSettingsLayerSchema = z.object({
  /** Language of the fixed labels in messages the omomeow scripts compose (default: "en"). */
  language: z.enum(OMOMEOW_LANGUAGES),
  nudge: OmoMeowNudgeLayerSchema,
}).partial().strict()

export const OmoMeowSettingsSchema = z.object({
  language: z.enum(OMOMEOW_LANGUAGES).default("en"),
  nudge: OmoMeowNudgeSchema.default({ enabled: true, interval_minutes: 30 }),
}).strict()

export type OmoMeowSettings = z.infer<typeof OmoMeowSettingsSchema>
export type OmoMeowSettingsLayer = z.infer<typeof OmoMeowSettingsLayerSchema>

export interface OmoMeowConfigView {
  readonly omomeow?: OmoMeowSettings
}

type OmoMeowSettingPath = "omomeow.language" | "omomeow.nudge.enabled" | "omomeow.nudge.interval_minutes"

/**
 * Read by the `omomeow` skill scripts (packages/omo-senpi/skills/omomeow/scripts/lib/config.mjs), which run
 * outside the extension and resolve only the user and project layers, so the section is top-level only.
 */
export const OMOMEOW_HARNESS_SUPPORT: Record<OmoMeowSettingPath, readonly OmoHarnessId[]> = {
  "omomeow.language": ["native"],
  "omomeow.nudge.enabled": ["native"],
  "omomeow.nudge.interval_minutes": ["native"],
} as const

/** Resolve the effective omomeow settings, applying defaults when the section is absent. */
export function resolveOmoMeowSettings(config: OmoMeowConfigView): OmoMeowSettings {
  return config.omomeow ?? OmoMeowSettingsSchema.parse({})
}
