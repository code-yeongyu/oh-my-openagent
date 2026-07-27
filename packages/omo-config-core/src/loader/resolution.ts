import { HARNESS_IDS, OMO_CONFIG_HARNESS_IDS, type HarnessId, type OmoHarnessId } from "../schema"
import { mergeOmoConfigRecords } from "./merge"
import type { OmoConfigDiagnostic, OmoConfigEnv } from "./types"

export type ResolveOmoProfileNameOptions = {
  readonly env?: OmoConfigEnv
  readonly profile?: string
}

export type ResolveOmoConfigViewOptions = {
  readonly config: Readonly<Record<string, unknown>>
  readonly harness?: OmoHarnessId | HarnessId
  readonly profile?: string
}

export type ResolveOmoConfigViewResult = {
  readonly config: Record<string, unknown>
  readonly diagnostics: readonly OmoConfigDiagnostic[]
  readonly profile?: string
}

const HARNESS_KEYS = [...new Set([...HARNESS_IDS, ...OMO_CONFIG_HARNESS_IDS])].map((harness) => `[${harness}]`)

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

function harnessLayer(config: Readonly<Record<string, unknown>>, harness?: OmoHarnessId | HarnessId): Record<string, unknown> {
  if (harness === undefined) return {}
  return toRecord(config[`[${harness}]`]) ?? {}
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
