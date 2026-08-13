import { HARNESS_IDS, OMO_CONFIG_HARNESS_IDS, type HarnessId, type OmoHarnessId } from "../schema"
import { mergeOmoConfigRecords } from "./merge"
import type { OmoConfigDiagnostic, OmoConfigEnv, OmoConfigRawLayer } from "./types"

export type ResolveOmoProfileNameOptions = {
  readonly env?: OmoConfigEnv
  readonly persisted?: string
  readonly profile?: string
}

export type OmoProfileOrigin = "explicit" | "OMO_PROFILE" | "OCX_PROFILE" | "OPENCODE_CONFIG_DIR" | "persisted"

export type ResolvedOmoProfile = {
  readonly name: string
  readonly origin: OmoProfileOrigin
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

export const OMO_ACTIVE_PROFILE_KEY = "active_profile"

function profileName(value: string | undefined): string | undefined {
  return value === "" ? undefined : value
}

function profileNameFromOpenCodeConfigDir(path: string | undefined): string | undefined {
  const match = path?.match(/(?:^|[\\/])profiles[\\/]([^\\/]+)[\\/]*$/)
  return profileName(match?.[1])
}

export function readPersistedOmoProfileName(config: Readonly<Record<string, unknown>>): string | undefined {
  const value = config[OMO_ACTIVE_PROFILE_KEY]
  return typeof value === "string" ? profileName(value) : undefined
}

export function readPersistedOmoProfileFromLayers(layers: readonly OmoConfigRawLayer[]): {
  readonly ignoredPaths: readonly string[]
  readonly persisted?: string
} {
  let persisted: string | undefined
  const ignoredPaths: string[] = []
  for (const layer of layers) {
    const name = readPersistedOmoProfileName(layer.config)
    if (name === undefined) continue
    if (layer.source.scope === "user") persisted = name
    else ignoredPaths.push(layer.source.path)
  }
  return { ignoredPaths, ...(persisted === undefined ? {} : { persisted }) }
}

export function ignoredProjectProfileDiagnostics(paths: readonly string[]): readonly OmoConfigDiagnostic[] {
  return paths.map((path) => ({
    kind: "profile" as const,
    message: `Ignoring "${OMO_ACTIVE_PROFILE_KEY}" in ${path}: profile activation is read from the user omo config only`,
    path,
  }))
}

export function resolveOmoProfile(options: ResolveOmoProfileNameOptions = {}): ResolvedOmoProfile | undefined {
  const env = options.env ?? process.env
  const candidates: readonly (readonly [OmoProfileOrigin, string | undefined])[] = [
    ["explicit", profileName(options.profile)],
    ["OMO_PROFILE", profileName(env["OMO_PROFILE"])],
    ["OCX_PROFILE", profileName(env["OCX_PROFILE"])],
    ["OPENCODE_CONFIG_DIR", profileNameFromOpenCodeConfigDir(env["OPENCODE_CONFIG_DIR"])],
    ["persisted", profileName(options.persisted)],
  ]
  for (const [origin, name] of candidates) {
    if (name !== undefined) return { name, origin }
  }
  return undefined
}

export function resolveOmoProfileName(options: ResolveOmoProfileNameOptions = {}): string | undefined {
  return resolveOmoProfile(options)?.name
}

function toRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined
  return Object.fromEntries(Object.entries(value))
}

function withoutControlKeys(config: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(config)) {
    if (key === "profiles" || key === OMO_ACTIVE_PROFILE_KEY || HARNESS_KEYS.includes(key)) continue
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
