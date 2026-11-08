import {
  canonicalHarnessName,
  harnessBlockKey,
  HARNESS_IDS,
  OMO_CONFIG_HARNESS_IDS,
  OMO_CONFIG_LEGACY_HARNESS_ALIASES,
  OMO_CONFIG_LEGACY_HARNESS_IDS,
  type HarnessId,
  type OmoHarnessId,
  type OmoLegacyHarnessId,
} from "../schema"
import { mergeOmoConfigRecords } from "./merge"
import type { OmoConfigDiagnostic, OmoConfigEnv } from "./types"

export type ResolveOmoProfileNameOptions = {
  readonly env?: OmoConfigEnv
  readonly profile?: string
}

export type ResolveOmoConfigViewOptions = {
  readonly config: Readonly<Record<string, unknown>>
  readonly harness?: OmoHarnessId | OmoLegacyHarnessId | HarnessId
  readonly profile?: string
}

export type ResolveOmoConfigViewResult = {
  readonly config: Record<string, unknown>
  readonly diagnostics: readonly OmoConfigDiagnostic[]
  readonly profile?: string
}

const HARNESS_KEYS = [...new Set([...HARNESS_IDS, ...OMO_CONFIG_HARNESS_IDS, ...OMO_CONFIG_LEGACY_HARNESS_IDS])]
  .map((harness) => harnessBlockKey(harness))

function profileName(value: string | undefined): string | undefined {
  return value === "" ? undefined : value
}

function profileNameFromOpenCodeConfigDir(path: string | undefined): string | undefined {
  const match = path?.match(/(?:^|[\\/])profiles[\\/]([^\\/]+)[\\/]*$/)
  return profileName(match?.[1])
}

export function resolveOmoProfileName(options: ResolveOmoProfileNameOptions = {}): string | undefined {
  const env = options.env ?? process.env
  return profileName(options.profile)
    ?? profileName(env["OMO_PROFILE"])
    ?? profileName(env["OCX_PROFILE"])
    ?? profileNameFromOpenCodeConfigDir(env["OPENCODE_CONFIG_DIR"])
}

function toRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined
  return Object.fromEntries(Object.entries(value))
}

function withoutControlKeys(config: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(config)) {
    if (key === "profiles" || HARNESS_KEYS.includes(key)) continue
    result[key] = value
  }
  return result
}

// The legacy block is folded in FIRST so the canonical `[native]` block wins every key it also
// sets, while a config that only ever named `[senpi]` keeps applying in full.
function harnessLayer(
  config: Readonly<Record<string, unknown>>,
  harness?: OmoHarnessId | OmoLegacyHarnessId | HarnessId,
): Record<string, unknown> {
  if (harness === undefined) return {}
  const canonical = canonicalHarnessName(harness)
  const legacyKeys = Object.entries(OMO_CONFIG_LEGACY_HARNESS_ALIASES)
    .filter(([, target]) => target === canonical)
    .map(([legacy]) => harnessBlockKey(legacy))
  let layer: Record<string, unknown> = {}
  for (const key of [...legacyKeys, harnessBlockKey(canonical)]) {
    layer = mergeOmoConfigRecords(layer, toRecord(config[key]) ?? {})
  }
  return layer
}

export function resolveOmoConfigView(options: ResolveOmoConfigViewOptions): ResolveOmoConfigViewResult {
  const profiles = toRecord(options.config["profiles"])
  const profile = options.profile === undefined ? undefined : toRecord(profiles?.[options.profile])
  const diagnostics: OmoConfigDiagnostic[] = profile === undefined && options.profile !== undefined
    ? [{
      kind: "profile",
      message: `Activated omo profile \"${options.profile}\" does not exist; using the base configuration`,
      path: `profiles.${options.profile}`,
    }]
    : []
  const layers = [
    withoutControlKeys(options.config),
    harnessLayer(options.config, options.harness),
    profile === undefined ? {} : withoutControlKeys(profile),
    profile === undefined ? {} : harnessLayer(profile, options.harness),
  ]

  let config: Record<string, unknown> = {}
  for (const layer of layers) config = mergeOmoConfigRecords(config, layer)

  const resolvedProfile = options.profile !== undefined && profile !== undefined ? options.profile : undefined
  return {
    config: withoutControlKeys(config),
    diagnostics,
    ...(resolvedProfile === undefined ? {} : { profile: resolvedProfile }),
  }
}
