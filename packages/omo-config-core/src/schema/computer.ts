import * as z from "zod"

import type { OmoHarnessId } from "./harness"

const positiveInteger = z.number().int().positive()
const nonNegativeInteger = z.number().int().nonnegative()

/**
 * The `computer` block: desktop computer use in omo-senpi. Every key is optional because the defaults
 * depend on the host (`enabled`, `stop_hotkey`); the computer-use component resolves them.
 */
export const OmoComputerSettingsLayerSchema = z
  .object({
    enabled: z.boolean(),
    display: z.string().min(1),
    max_width: positiveInteger,
    max_height: positiveInteger,
    screenshot_max_bytes: positiveInteger,
    stop_hotkey: z.string().min(1),
    allow_host_relay_only_stop: z.boolean(),
    macos_canary: z.enum(["session", "off"]),
    audit_log: z.object({ enabled: z.boolean() }).partial().strict(),
    screenshot_gc: z
      .object({ enabled: z.boolean(), stale_ms: nonNegativeInteger, scan_interval_ms: nonNegativeInteger })
      .partial()
      .strict(),
    engine_path: z.string().min(1),
    cua_adapter: z.boolean(),
  })
  .partial()
  .strict()

export const OmoComputerSettingsSchema = OmoComputerSettingsLayerSchema

export type OmoComputerSettings = z.infer<typeof OmoComputerSettingsSchema>

type ComputerSettingKey = keyof OmoComputerSettings
type ComputerSettingPath = `computer.${ComputerSettingKey}`

export const COMPUTER_HARNESS_SUPPORT: Record<ComputerSettingPath, readonly OmoHarnessId[]> = {
  "computer.enabled": ["native"],
  "computer.display": ["native"],
  "computer.max_width": ["native"],
  "computer.max_height": ["native"],
  "computer.screenshot_max_bytes": ["native"],
  "computer.stop_hotkey": ["native"],
  "computer.allow_host_relay_only_stop": ["native"],
  "computer.macos_canary": ["native"],
  "computer.audit_log": ["native"],
  "computer.screenshot_gc": ["native"],
  "computer.engine_path": ["native"],
  "computer.cua_adapter": ["native"],
} as const
