import { readFile } from "node:fs/promises"
import { join } from "node:path"

import type { DreamOrigin } from "@oh-my-opencode/memory-core"
import type { OmoMemorySettings } from "@oh-my-opencode/omo-config-core"

/** Unreflected-volume floor for transcript-driven automatic dream origins, in UTF-8 bytes (plan todo 24). */
export const DREAM_VOLUME_GATE_BYTES = 8192

export interface DreamTriggerSettings {
  readonly enabled: boolean
  readonly idleMinutes: number
  readonly minHoursBetween: number
  readonly shutdownLaunch: boolean
  readonly autoSelectMax: number
  readonly autoSelectMaxChars: number
}

export const DEFAULT_DREAM_TRIGGER_SETTINGS: DreamTriggerSettings = {
  enabled: true,
  idleMinutes: 30,
  minHoursBetween: 24,
  shutdownLaunch: true,
  autoSelectMax: 5,
  autoSelectMaxChars: 150000,
}

/** Resolved dream policy for the bound identity: per-agent overrides win field by field. */
export function resolveDreamTriggerSettings(settings: OmoMemorySettings, agentName?: string): DreamTriggerSettings {
  const base = settings.dream
  const override = agentName === undefined ? undefined : settings.agents[agentName]?.dream
  return {
    enabled: override?.enabled ?? base.enabled,
    idleMinutes: override?.idle_minutes ?? base.idle_minutes,
    minHoursBetween: override?.min_hours_between ?? base.min_hours_between,
    shutdownLaunch: override?.shutdown_launch ?? base.shutdown_launch,
    autoSelectMax: override?.auto_select_max ?? base.auto_select_max,
    autoSelectMaxChars: override?.auto_select_max_chars ?? base.auto_select_max_chars,
  }
}

export type DreamGateRejection = "disabled" | "shutdown_disabled" | "too_soon" | "insufficient_volume"

export type DreamGateDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly rejection: DreamGateRejection }

/** Lazily probed gate inputs so an early rejection never pays for a later probe. */
export interface DreamGateProbe {
  readonly nowMs: number
  readonly lastDreamAtMs: () => Promise<number | null>
  readonly unreflectedBytes: () => Promise<number>
}

/**
 * The single dream gate evaluation. Manual bypasses every automatic gate. Pressure applies
 * dream.enabled and the shared min_hours_between spacing, but not transcript volume. Idle and
 * shutdown additionally require unreflected volume strictly greater than 8192 bytes, while
 * shutdown also requires shutdown_launch.
 */
export async function evaluateDreamGates(
  origin: DreamOrigin,
  settings: DreamTriggerSettings,
  probe: DreamGateProbe,
): Promise<DreamGateDecision> {
  if (origin === "manual") return { allowed: true }
  if (!settings.enabled) return { allowed: false, rejection: "disabled" }
  if (origin === "shutdown" && !settings.shutdownLaunch) return { allowed: false, rejection: "shutdown_disabled" }
  const lastDreamAtMs = await probe.lastDreamAtMs()
  if (lastDreamAtMs !== null && probe.nowMs - lastDreamAtMs <= settings.minHoursBetween * 3_600_000) {
    return { allowed: false, rejection: "too_soon" }
  }
  if (origin !== "pressure" && (await probe.unreflectedBytes()) <= DREAM_VOLUME_GATE_BYTES) {
    return { allowed: false, rejection: "insufficient_volume" }
  }
  return { allowed: true }
}

/** Reads the todo 13 dream ledger (runtime/dream/state.json); absent or malformed means never. */
export async function readLastDreamAtMs(runtimeDir: string): Promise<number | null> {
  let raw: string
  try {
    raw = await readFile(join(runtimeDir, "dream", "state.json"), "utf8")
  } catch (error) {
    if (errorCode(error) === "ENOENT") return null
    throw error
  }
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!isRecord(parsed) || typeof parsed.last_dream_at !== "string") return null
    const parsedMs = Date.parse(parsed.last_dream_at)
    return Number.isFinite(parsedMs) ? parsedMs : null
  } catch (error) {
    if (error instanceof SyntaxError) return null
    throw error
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function errorCode(error: unknown): string | undefined {
  if (!(error instanceof Error) || !("code" in error)) return undefined
  return typeof error.code === "string" ? error.code : undefined
}
