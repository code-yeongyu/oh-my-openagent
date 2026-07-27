import * as z from "zod"

import { HARNESS_IDS, type HarnessId } from "./harness"

const OmoCodegraphSettingsShape = {
  enabled: z.boolean(),
  auto_provision: z.boolean(),
  daemon: z.boolean(),
  telemetry: z.boolean(),
  install_dir: z.string().optional(),
  watch_debounce_ms: z.number().finite().nonnegative().optional(),
  excluded_roots: z.array(z.string()).optional(),
  session_start_cooldown_ms: z.number().finite().min(60_000).optional(),
}

export const OmoCodegraphSettingsLayerSchema = z.object(OmoCodegraphSettingsShape).partial().strict()

export const OmoCodegraphSettingsSchema = OmoCodegraphSettingsLayerSchema.extend({
  enabled: z.boolean().default(true),
  auto_provision: z.boolean().default(true),
  daemon: z.boolean().default(true),
  telemetry: z.boolean().default(false),
}).strict()

export type OmoCodegraphSettings = z.infer<typeof OmoCodegraphSettingsSchema>
export type OmoCodegraphSettingsLayer = z.infer<typeof OmoCodegraphSettingsLayerSchema>

export interface CodegraphConfig {
  readonly auto_provision?: boolean
  readonly daemon?: boolean
  readonly enabled?: boolean
  readonly excluded_roots?: readonly string[]
  readonly install_dir?: string
  readonly session_start_cooldown_ms?: number
  readonly telemetry?: boolean
  readonly watch_debounce_ms?: number
}

type CodegraphSettingKey = keyof CodegraphConfig
type SettingPath = `codegraph.${CodegraphSettingKey}`

export const SETTING_HARNESS_SUPPORT: Record<SettingPath, readonly HarnessId[]> = {
  "codegraph.auto_provision": HARNESS_IDS,
  "codegraph.daemon": ["codex", "opencode"],
  "codegraph.enabled": HARNESS_IDS,
  "codegraph.excluded_roots": ["codex", "opencode"],
  "codegraph.install_dir": HARNESS_IDS,
  "codegraph.session_start_cooldown_ms": ["codex"],
  "codegraph.telemetry": HARNESS_IDS,
  "codegraph.watch_debounce_ms": ["opencode", "omo"],
} as const
