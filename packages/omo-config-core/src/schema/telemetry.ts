import * as z from "zod"

import type { OmoHarnessId } from "./harness"

const OmoTelemetrySettingsShape = {
  enabled: z.boolean(),
  rawTurnSampleRate: z.number().min(0).max(1),
}

export const OmoTelemetrySettingsLayerSchema = z.object(OmoTelemetrySettingsShape).partial().strict()

// `rawTurnSampleRate` has no schema default on purpose: its default depends on the telemetry sink and is
// resolved by the Native telemetry component.
export const OmoTelemetrySettingsSchema = OmoTelemetrySettingsLayerSchema.extend({
  enabled: z.boolean().default(true),
}).strict()

export type OmoTelemetrySettings = z.infer<typeof OmoTelemetrySettingsSchema>
export type OmoTelemetrySettingsLayer = z.infer<typeof OmoTelemetrySettingsLayerSchema>

export interface OmoTelemetryConfigView {
  readonly telemetry?: OmoTelemetrySettings
}

type TelemetrySettingKey = keyof OmoTelemetrySettings
type TelemetrySettingPath = `telemetry.${TelemetrySettingKey}`

export const TELEMETRY_HARNESS_SUPPORT: Record<TelemetrySettingPath, readonly OmoHarnessId[]> = {
  "telemetry.enabled": ["native"],
  "telemetry.rawTurnSampleRate": ["native"],
} as const

export function isOmoTelemetryEnabled(config: OmoTelemetryConfigView): boolean {
  return config.telemetry?.enabled ?? true
}
