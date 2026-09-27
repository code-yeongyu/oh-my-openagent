import type { OmoComputerSettings } from "@oh-my-opencode/omo-config-core"
import { type ComputerSettings, type ComputerSettingsInput, resolveComputerSettings } from "@oh-my-opencode/senpi-desktop-tool"

export function toComputerSettingsInput(block: OmoComputerSettings | undefined): ComputerSettingsInput | undefined {
  if (block === undefined) return undefined
  const input: Record<string, unknown> = {
    enabled: block.enabled,
    display: block.display,
    maxWidth: block.max_width,
    maxHeight: block.max_height,
    screenshotMaxBytes: block.screenshot_max_bytes,
    stopHotkey: block.stop_hotkey,
    allowHostRelayOnlyStop: block.allow_host_relay_only_stop,
    macosCanary: block.macos_canary,
    auditLog: block.audit_log === undefined ? undefined : { enabled: block.audit_log.enabled },
    screenshotGc:
      block.screenshot_gc === undefined
        ? undefined
        : {
            enabled: block.screenshot_gc.enabled,
            staleMs: block.screenshot_gc.stale_ms,
            scanIntervalMs: block.screenshot_gc.scan_interval_ms,
          },
    enginePath: block.engine_path,
    cuaAdapter: block.cua_adapter,
  }
  return JSON.parse(JSON.stringify(input)) as ComputerSettingsInput
}

export function resolveOmoComputerSettings(block: OmoComputerSettings | undefined, platform: string): ComputerSettings {
  return resolveComputerSettings(toComputerSettingsInput(block), platform)
}
