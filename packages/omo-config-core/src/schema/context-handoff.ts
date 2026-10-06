import * as z from "zod"

import type { OmoConfig } from "./config"

const OmoContextHandoffSettingsShape = {
  enabled: z.boolean(),
  threshold_percent: z.number().int().min(1).max(99),
  compaction_repeat_limit: z.number().int().min(2).max(20),
  compaction_repeat_window_minutes: z.number().int().min(1).max(120),
}

export const OmoContextHandoffSettingsLayerSchema = z.object(OmoContextHandoffSettingsShape).partial().strict()

export const OmoContextHandoffSettingsSchema = OmoContextHandoffSettingsLayerSchema.extend({
  enabled: z.boolean().default(false),
  threshold_percent: z.number().int().min(1).max(99).default(85),
  compaction_repeat_limit: z.number().int().min(2).max(20).default(3),
  compaction_repeat_window_minutes: z.number().int().min(1).max(120).default(10),
}).strict()

export type OmoContextHandoffSettings = z.infer<typeof OmoContextHandoffSettingsSchema>
export type OmoContextHandoffSettingsLayer = z.infer<typeof OmoContextHandoffSettingsLayerSchema>

export interface ResolvedOmoContextHandoffSettings {
  readonly enabled: boolean
  readonly thresholdPercent: number
  readonly repeatLimit: number
  readonly repeatWindowMs: number
}

export function resolveOmoContextHandoffSettings(config: OmoConfig): ResolvedOmoContextHandoffSettings {
  const settings = config.context_handoff ?? OmoContextHandoffSettingsSchema.parse({})
  return {
    enabled: settings.enabled,
    thresholdPercent: settings.threshold_percent,
    repeatLimit: settings.compaction_repeat_limit,
    repeatWindowMs: settings.compaction_repeat_window_minutes * 60_000,
  }
}
